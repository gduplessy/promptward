import {
  isPromptWardMessage,
  MESSAGE_TYPES,
  type PlaceholderSummary
} from "./shared/messages";

type WorkerRequest =
  | { id: string; type: "protect"; text: string; conversationKey: string; modelBaseUrl: string; ortBaseUrl: string }
  | { id: string; type: "reveal"; text: string; conversationKey: string }
  | { id: string; type: "prewarm"; modelBaseUrl: string; ortBaseUrl: string }
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

let worker: Worker | undefined;
const pending = new Map<string, (response: WorkerResponse) => void>();

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
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
        ortBaseUrl: chrome.runtime.getURL("ort/")
      });
    case MESSAGE_TYPES.protectText:
      return postWorker({
        id: crypto.randomUUID(),
        type: "protect",
        modelBaseUrl: chrome.runtime.getURL("models/"),
        ortBaseUrl: chrome.runtime.getURL("ort/"),
        text: message.text,
        conversationKey: message.conversationKey
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
  worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
    const resolve = pending.get(event.data.id);
    if (!resolve) return;
    pending.delete(event.data.id);
    resolve(event.data);
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

function postWorker(request: WorkerRequest): Promise<WorkerResponse> {
  return new Promise((resolve) => {
    pending.set(request.id, resolve);
    getWorker().postMessage(request);
  });
}
