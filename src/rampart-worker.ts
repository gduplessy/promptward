import { env } from "@huggingface/transformers";
import { createGuard, detectNer, loadNerClassifier, type ChatGuard, type NerDetector, type TokenClassifier } from "@nationaldesignstudio/rampart";
import type { PlaceholderSummary } from "./shared/messages";

type WorkerRequest =
  | { id: string; type: "protect"; text: string; conversationKey: string; modelUrl: string }
  | { id: string; type: "reveal"; text: string; conversationKey: string }
  | { id: string; type: "prewarm"; modelUrl: string }
  | { id: string; type: "reset"; conversationKey: string };

configureLocalRuntime();

let classifierPromise: Promise<TokenClassifier> | undefined;
let detector: NerDetector | undefined;
let coldStartPromise: Promise<number> | undefined;
const guards = new Map<string, ChatGuard>();

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  void handleRequest(event.data)
    .then((response) => self.postMessage({ id: event.data.id, ok: true, ...response }))
    .catch((error: unknown) => {
      self.postMessage({
        id: event.data.id,
        ok: false,
        status: "error",
        error: error instanceof Error ? error.message : "Rampart worker error"
      });
    });
});

function configureLocalRuntime(): void {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = new URL("../models/", import.meta.url).href;
  const wasm = env.backends.onnx.wasm;
  if (!wasm) throw new Error("Transformers ONNX WASM backend is unavailable");
  wasm.wasmPaths = new URL("../ort/", import.meta.url).href;
  wasm.proxy = false;
  wasm.numThreads = 1;
}

async function handleRequest(request: WorkerRequest): Promise<Record<string, unknown>> {
  switch (request.type) {
    case "prewarm": {
      const coldStartMs = await prewarm(request.modelUrl);
      return { status: "ready", coldStartMs };
    }
    case "protect": {
      const start = performance.now();
      const guard = await getGuard(request.conversationKey, request.modelUrl);
      const result = await guard.protect(request.text);
      const placeholders = summarizePlaceholders(result.placeholders);
      return {
        safeText: result.text,
        changed: result.text !== request.text,
        placeholders,
        durationMs: Math.round(performance.now() - start)
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

async function prewarm(modelUrl: string): Promise<number> {
  if (!coldStartPromise) {
    coldStartPromise = (async () => {
      const start = performance.now();
      classifierPromise = loadNerClassifier({ model: modelUrl, device: "wasm" });
      const classifier = await classifierPromise;
      detector = (text: string) => detectNer(text, classifier);
      return Math.round(performance.now() - start);
    })();
  }
  return coldStartPromise;
}

async function getGuard(conversationKey: string, modelUrl: string): Promise<ChatGuard> {
  const existing = guards.get(conversationKey);
  if (existing) return existing;
  await prewarm(modelUrl);
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
