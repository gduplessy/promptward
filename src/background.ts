import {
  isPromptWardMessage,
  MESSAGE_TYPES,
  type PromptWardMessage
} from "./shared/messages";
import { DEBUG_LOG_LIMIT, DEFAULT_DEBUG_SETTINGS, normalizeDebugEvent, type DebugEvent, type DebugSettings } from "./shared/debug";
import { isSiteEnabled, isValidCustomHost, loadSettings, normalizeHost, setHostEnabled } from "./shared/settings";

const OFFSCREEN_PATH = "src/offscreen.html";
const DEBUG_LOGS_KEY = "promptwardDebugLogs";
const DEBUG_SETTINGS_KEY = "promptwardDebugSettings";

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  void registerCustomDomainScripts();
});

chrome.runtime.onStartup.addListener(() => {
  void registerCustomDomainScripts();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes.customDomains) {
    void registerCustomDomainScripts();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void sendToOffscreen({
    type: MESSAGE_TYPES.resetConversation,
    conversationKey: `${tabId}:`
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    void sendToOffscreen({
      type: MESSAGE_TYPES.resetConversation,
      conversationKey: `${tabId}:`
    });
  }
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  void handleMessage(message, sender)
    .then(sendResponse)
    .catch((error: unknown) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown PromptWard error"
      });
    });
  return true;
});

async function handleMessage(message: unknown, sender: chrome.runtime.MessageSender): Promise<unknown> {
  if (!isPromptWardMessage(message)) {
    return { ok: false, error: "Invalid PromptWard message" };
  }

  if (message.type === MESSAGE_TYPES.getSettings) {
    return loadSettings();
  }

  if (message.type === MESSAGE_TYPES.getDebugSettings) {
    return loadDebugSettings();
  }

  if (message.type === MESSAGE_TYPES.setDebugSettings) {
    await chrome.storage.local.set({
      [DEBUG_SETTINGS_KEY]: { rawDiagnosticsEnabled: message.rawDiagnosticsEnabled }
    });
    return { ok: true };
  }

  if (message.type === MESSAGE_TYPES.getDebugLogs) {
    return { ok: true, events: await loadDebugLogs() };
  }

  if (message.type === MESSAGE_TYPES.clearDebugLogs) {
    await chrome.storage.session.set({ [DEBUG_LOGS_KEY]: [] });
    return { ok: true };
  }

  if (message.type === MESSAGE_TYPES.debugLog) {
    await appendDebugEvent(normalizeDebugEvent(message.event));
    return { ok: true };
  }

  if (message.type === MESSAGE_TYPES.setSiteEnabled) {
    await setHostEnabled(message.host, message.enabled);
    return { ok: true };
  }

  if (message.type === MESSAGE_TYPES.protectText) {
    await appendDebugEvent(
      normalizeDebugEvent({
        debugId: message.debugId ?? "missing-debug-id",
        context: "background",
        stage: "protect-message-received",
        level: "debug",
        url: message.url,
        metadata: {
          hasSenderTab: Boolean(sender.tab?.id),
          senderTabId: sender.tab?.id,
          senderFrameId: sender.frameId
        }
      })
    );
    const settings = await loadSettings();
    const url = new URL(message.url);
    if (!isSiteEnabled(url, settings)) {
      await appendDebugEvent(
        normalizeDebugEvent({
          debugId: message.debugId ?? "missing-debug-id",
          context: "background",
          stage: "site-disabled",
          level: "warn",
          url: message.url,
          metadata: { host: url.hostname }
        })
      );
      return {
        ok: true,
        safeText: message.text,
        changed: false,
        placeholders: [],
        durationMs: 0
      };
    }

    if (!sender.tab?.id) {
      return { ok: false, error: "Missing sender tab" };
    }

    const enriched = {
      ...message,
      conversationKey: `${sender.tab.id}:${sender.frameId ?? 0}:${url.origin}:${url.pathname}`
    };
    await appendDebugEvent(
      normalizeDebugEvent({
        debugId: message.debugId ?? "missing-debug-id",
        context: "background",
        stage: "offscreen-route",
        level: "debug",
        url: message.url,
        metadata: {
          conversationKey: enriched.conversationKey,
          host: url.hostname
        }
      })
    );
    return sendToOffscreen(enriched);
  }

  return sendToOffscreen(message);
}

async function loadDebugSettings(): Promise<DebugSettings> {
  const stored = await chrome.storage.local.get(DEBUG_SETTINGS_KEY);
  return {
    ...DEFAULT_DEBUG_SETTINGS,
    ...((stored[DEBUG_SETTINGS_KEY] as Partial<DebugSettings> | undefined) ?? {})
  };
}

async function loadDebugLogs(): Promise<DebugEvent[]> {
  const stored = await chrome.storage.session.get(DEBUG_LOGS_KEY);
  const events = stored[DEBUG_LOGS_KEY];
  return Array.isArray(events) ? (events as DebugEvent[]) : [];
}

async function appendDebugEvent(event: DebugEvent): Promise<void> {
  const events = await loadDebugLogs();
  const next = [...events, event].slice(-DEBUG_LOG_LIMIT);
  await chrome.storage.session.set({ [DEBUG_LOGS_KEY]: next });
  console.debug("[PromptWard]", event);
}

async function sendToOffscreen(message: PromptWardMessage): Promise<unknown> {
  await ensureOffscreenDocument();
  return chrome.runtime.sendMessage(message);
}

let offscreenCreation: Promise<void> | undefined;

function ensureOffscreenDocument(): Promise<void> {
  const next = (offscreenCreation ?? Promise.resolve())
    .catch(() => undefined) // a past failure must not poison future attempts
    .then(() => createOffscreenDocumentIfMissing());
  offscreenCreation = next;
  return next;
}

async function createOffscreenDocumentIfMissing(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)]
  });
  if (contexts.length > 0) return;
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: "Runs the local Rampart model worker outside the MV3 service worker lifecycle."
    });
  } catch (error) {
    // A concurrent path (or a pre-existing document the getContexts snapshot
    // missed) already created it - that is success, not failure.
    if (error instanceof Error && /single offscreen document/i.test(error.message)) return;
    throw error;
  }
}

async function registerCustomDomainScripts(): Promise<void> {
  const settings = await loadSettings();
  await chrome.scripting.unregisterContentScripts({ ids: ["promptward-custom-domains"] }).catch(() => undefined);

  const hosts = settings.customDomains.map(normalizeHost).filter(isValidCustomHost);
  if (hosts.length === 0) return;

  const matches = hosts.map((host) => `*://${host}/*`);

  await chrome.scripting
    .registerContentScripts([
      {
        id: "promptward-custom-domains",
        js: ["src/content.ts"],
        matches,
        runAt: "document_start",
        allFrames: true,
        persistAcrossSessions: true
      }
    ])
    .catch((error: unknown) => {
      console.warn("[PromptWard] custom domain registration failed", error);
    });
}
