import { env, pipeline } from "@huggingface/transformers";
import { createGuard, detectNer, type ChatGuard, type NerDetector, type TokenClassifier } from "@nationaldesignstudio/rampart";
import type { PlaceholderSummary } from "./shared/messages";
import { APP_VERSION, type DebugLogInput } from "./shared/debug";
import type { WorkerRequest, WorkerResponse } from "./shared/worker-protocol";

const LOCAL_MODEL_ID = "rampart";

let classifierPromise: Promise<TokenClassifier> | undefined;
let detector: NerDetector | undefined;
let coldStartPromise: Promise<number> | undefined;
let configuredPaths: { modelBaseUrl: string; ortBaseUrl: string } | undefined;
const guards = new Map<string, ChatGuard>();

function respond(response: WorkerResponse): void {
  self.postMessage(response);
}

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  void handleRequest(event.data)
    .then((response) =>
      // handleRequest returns an untyped Record<string, unknown> whose shape depends on
      // request.type; trusting it to match the corresponding WorkerResponse variant here
      // avoids restructuring handleRequest's return type for this dedupe.
      respond({ id: event.data.id, ok: true, ...response } as WorkerResponse)
    )
    .catch((error: unknown) => {
      logDebug({
        debugId: "debugId" in event.data && event.data.debugId ? event.data.debugId : event.data.id,
        stage: `${event.data.type}-error`,
        level: "error",
        metadata: {
          error: error instanceof Error ? error.message : "Rampart worker error"
        }
      });
      respond({
        id: event.data.id,
        ok: false,
        status: "error",
        error: error instanceof Error ? error.message : "Rampart worker error"
      });
    });
});

function configureLocalRuntime(modelBaseUrl: string, ortBaseUrl: string): void {
  if (configuredPaths?.modelBaseUrl === modelBaseUrl && configuredPaths.ortBaseUrl === ortBaseUrl) return;
  if (classifierPromise) throw new Error("Cannot reconfigure Rampart assets after model initialization");

  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.useBrowserCache = false;
  env.useFSCache = false;
  env.useCustomCache = false;
  env.localModelPath = modelBaseUrl;
  const wasm = env.backends.onnx.wasm;
  if (!wasm) throw new Error("Transformers ONNX WASM backend is unavailable");
  wasm.wasmPaths = ortBaseUrl;
  wasm.proxy = false;
  wasm.numThreads = 1;
  configuredPaths = { modelBaseUrl, ortBaseUrl };
  logDebug({
    debugId: "runtime",
    stage: "runtime-configured",
    level: "info",
    metadata: {
      modelBaseUrl,
      ortBaseUrl,
      allowRemoteModels: env.allowRemoteModels,
      allowLocalModels: env.allowLocalModels,
      useBrowserCache: env.useBrowserCache,
      useFSCache: env.useFSCache,
      useCustomCache: env.useCustomCache
    }
  });
}

async function handleRequest(request: WorkerRequest): Promise<Record<string, unknown>> {
  switch (request.type) {
    case "prewarm": {
      logDebug({
        debugId: request.debugId ?? request.id,
        stage: "prewarm-start",
        level: "debug",
        metadata: {}
      });
      const coldStartMs = await prewarm(request.modelBaseUrl, request.ortBaseUrl);
      logDebug({
        debugId: request.debugId ?? request.id,
        stage: "prewarm-end",
        level: "info",
        metadata: { coldStartMs }
      });
      return { status: "ready", coldStartMs };
    }
    case "protect": {
      const start = performance.now();
      logDebug({
        debugId: request.debugId ?? request.id,
        stage: "protect-start",
        level: "debug",
        metadata: {
          textLength: request.text.length,
          conversationKey: request.conversationKey
        },
        raw: request.rawDiagnosticsEnabled ? { original: request.text } : undefined
      });
      const guard = await getGuard(request.conversationKey, request.modelBaseUrl, request.ortBaseUrl);
      const result = await guard.protect(request.text);
      const placeholders = summarizePlaceholders(result.placeholders);
      const durationMs = Math.round(performance.now() - start);
      logDebug({
        debugId: request.debugId ?? request.id,
        stage: "protect-end",
        level: "debug",
        metadata: {
          changed: result.text !== request.text,
          placeholderCount: placeholders.length,
          durationMs
        },
        raw: request.rawDiagnosticsEnabled ? { redacted: result.text } : undefined
      });
      return {
        safeText: result.text,
        changed: result.text !== request.text,
        placeholders,
        durationMs
      };
    }
    case "reveal": {
      const guard = guards.get(request.conversationKey);
      return { text: guard ? guard.reveal(request.text) : request.text };
    }
    case "reset": {
      for (const key of [...guards.keys()]) {
        if (key.startsWith(request.conversationKey)) guards.delete(key);
      }
      return {};
    }
    default:
      throw new Error("Unsupported Rampart worker request");
  }
}

function logDebug(event: Omit<DebugLogInput, "context" | "version">): void {
  self.postMessage({
    type: "debug",
    event: {
      ...event,
      context: "worker",
      version: APP_VERSION
    }
  });
}

async function prewarm(modelBaseUrl: string, ortBaseUrl: string): Promise<number> {
  configureLocalRuntime(modelBaseUrl, ortBaseUrl);
  if (!coldStartPromise) {
    coldStartPromise = (async () => {
      const start = performance.now();
      classifierPromise = loadLocalNerClassifier();
      const classifier = await classifierPromise;
      detector = (text: string) => detectNer(text, classifier);
      return Math.round(performance.now() - start);
    })();
  }
  return coldStartPromise;
}

async function loadLocalNerClassifier(): Promise<TokenClassifier> {
  const classifier = (await pipeline("token-classification", LOCAL_MODEL_ID, {
    dtype: "q4",
    device: "wasm",
    local_files_only: true,
    progress_callback: (progress: unknown) => {
      logDebug({
        debugId: "model-load",
        stage: "model-load-progress",
        level: "debug",
        metadata: sanitizeProgress(progress)
      });
    }
  })) as unknown as TokenClassifier & {
    tokenizer?: { encode?: (text: string, options: { add_special_tokens: boolean }) => unknown[] };
  };

  const adapter: TokenClassifier = (text, opts) => classifier(text, opts);
  const tokenizer = classifier.tokenizer;
  if (tokenizer?.encode) {
    adapter.countTokens = (text) => tokenizer.encode?.(text, { add_special_tokens: false }).length ?? 0;
  }
  return adapter;
}

function sanitizeProgress(progress: unknown): Record<string, unknown> {
  if (!progress || typeof progress !== "object") return { progress };
  const value = progress as Record<string, unknown>;
  return {
    status: value.status,
    name: value.name,
    file: value.file,
    progress: typeof value.progress === "number" ? Math.round(value.progress) : value.progress,
    loaded: value.loaded,
    total: value.total
  };
}

async function getGuard(conversationKey: string, modelBaseUrl: string, ortBaseUrl: string): Promise<ChatGuard> {
  const existing = guards.get(conversationKey);
  if (existing) return existing;
  await prewarm(modelBaseUrl, ortBaseUrl);
  if (!detector) throw new Error("Rampart detector did not initialize");
  const guard = await createGuard({ ner: detector });
  guards.set(conversationKey, guard);
  return guard;
}

function summarizePlaceholders(placeholders: readonly string[]): PlaceholderSummary[] {
  return placeholders.map((token) => ({
    token,
    label: token.replace(/^\[/, "").replace(/_\d+\]$/, "")
  }));
}
