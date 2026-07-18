import {
  isPromptWardMessage,
  MESSAGE_TYPES,
  type PlaceholderSummary
} from "./shared/messages";
import { APP_VERSION, type DebugLogInput, type DebugSettings } from "./shared/debug";
import { isOffscreenOwnedMessage } from "./shared/offscreen-routing";
import { withTimeout } from "./shared/timeout";

type WorkerRequest =
  | {
      id: string;
      type: "protect";
      text: string;
      conversationKey: string;
      modelBaseUrl: string;
      ortBaseUrl: string;
      debugId?: string;
      rawDiagnosticsEnabled: boolean;
    }
  | { id: string; type: "reveal"; text: string; conversationKey: string }
  | { id: string; type: "prewarm"; modelBaseUrl: string; ortBaseUrl: string; debugId?: string; rawDiagnosticsEnabled: boolean }
  | { id: string; type: "reset"; conversationKey: string };

type WorkerResponse =
  | { id: string; ok: true; status: "ready" | "loading"; coldStartMs?: number }
  | {
      id: string;
      ok: true;
      safeText: string;
      changed: boolean;
      placeholders: PlaceholderSummary[];
      durationMs: number;
    }
  | { id: string; ok: true; text: string }
  | { id: string; ok: true }
  | { id: string; ok: false; error: string; status?: "error" };

type WorkerDebugMessage = {
  type: "debug";
  event: DebugLogInput;
};

let worker: Worker | undefined;
const pending = new Map<string, (response: WorkerResponse) => void>();

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isOffscreenOwnedMessage(message)) {
    return false;
  }
  void handleMessage(message)
    .then(sendResponse)
    .catch((error: unknown) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown offscreen error"
      });
    });
  return true;
});

async function handleMessage(message: unknown): Promise<unknown> {
  if (!isPromptWardMessage(message)) {
    return { ok: false, error: "Invalid PromptWard message" };
  }

  switch (message.type) {
    case MESSAGE_TYPES.prewarmModel:
      return postWorker({
        id: crypto.randomUUID(),
        type: "prewarm",
        modelBaseUrl: chrome.runtime.getURL("models/"),
        ortBaseUrl: chrome.runtime.getURL("ort/"),
        rawDiagnosticsEnabled: await isRawDiagnosticsEnabled()
      });
    case MESSAGE_TYPES.protectText:
      return postWorker({
        id: crypto.randomUUID(),
        type: "protect",
        modelBaseUrl: chrome.runtime.getURL("models/"),
        ortBaseUrl: chrome.runtime.getURL("ort/"),
        text: message.text,
        conversationKey: message.conversationKey,
        debugId: message.debugId,
        rawDiagnosticsEnabled: await isRawDiagnosticsEnabled()
      });
    case MESSAGE_TYPES.revealText:
      return postWorker({
        id: crypto.randomUUID(),
        type: "reveal",
        text: message.text,
        conversationKey: message.conversationKey
      });
    case MESSAGE_TYPES.resetConversation:
      return postWorker({ id: crypto.randomUUID(), type: "reset", conversationKey: message.conversationKey });
    default:
      return { ok: false, error: "Unsupported offscreen message" };
  }
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./rampart-worker.ts", import.meta.url), { type: "module" });
  void logDebug({
    debugId: "worker-lifecycle",
    context: "offscreen",
    stage: "worker-created",
    level: "info",
    metadata: {}
  });
  worker.addEventListener("message", (event: MessageEvent<WorkerResponse | WorkerDebugMessage>) => {
    const data = event.data;
    if (isWorkerDebugMessage(data)) {
      void logDebug({ ...data.event, context: "worker" });
      return;
    }
    const resolve = pending.get(data.id);
    if (!resolve) return;
    pending.delete(data.id);
    resolve(data);
  });
  worker.addEventListener("error", () => {
    for (const resolve of pending.values()) {
      resolve({ id: crypto.randomUUID(), ok: false, error: "Rampart worker failed", status: "error" });
    }
    pending.clear();
    worker = undefined;
  });
  return worker;
}

function isWorkerDebugMessage(value: WorkerResponse | WorkerDebugMessage): value is WorkerDebugMessage {
  return "type" in value && value.type === "debug";
}

const WORKER_TIMEOUT_MS: Record<WorkerRequest["type"], number> = {
  prewarm: 300_000, // cold model load on slow hardware — be generous
  protect: 240_000, // includes a possible cold start on first send
  reveal: 15_000,
  reset: 15_000
};

function postWorker(request: WorkerRequest): Promise<WorkerResponse> {
  const raw = new Promise<WorkerResponse>((resolve) => {
    void logDebug({
      debugId: "debugId" in request && request.debugId ? request.debugId : request.id,
      context: "offscreen",
      stage: "worker-request",
      level: "debug",
      metadata: {
        requestType: request.type,
        hasText: "text" in request,
        textLength: "text" in request ? request.text.length : undefined
      }
    });
    pending.set(request.id, resolve);
    getWorker().postMessage(request);
  });
  return withTimeout(raw, WORKER_TIMEOUT_MS[request.type], () => {
    pending.delete(request.id);
    void logDebug({
      debugId: "debugId" in request && request.debugId ? request.debugId : request.id,
      context: "offscreen",
      stage: "worker-timeout",
      level: "error",
      metadata: { requestType: request.type, timeoutMs: WORKER_TIMEOUT_MS[request.type] }
    });
    return { id: request.id, ok: false, error: "PromptWard's local model did not respond in time.", status: "error" };
  });
}

async function isRawDiagnosticsEnabled(): Promise<boolean> {
  const settings = (await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.getDebugSettings }).catch(() => ({ rawDiagnosticsEnabled: false }))) as DebugSettings;
  return settings.rawDiagnosticsEnabled;
}

async function logDebug(event: DebugLogInput): Promise<void> {
  console.debug("[PromptWard]", event);
  await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.debugLog, event: { ...event, version: APP_VERSION } }).catch(() => undefined);
}
