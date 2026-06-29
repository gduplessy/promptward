import {
  isPromptWardMessage,
  MESSAGE_TYPES,
  type PromptWardMessage
} from "./shared/messages";
import { isSiteEnabled, loadSettings, setHostEnabled } from "./shared/settings";

const OFFSCREEN_PATH = "src/offscreen.html";

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

  if (message.type === MESSAGE_TYPES.setSiteEnabled) {
    await setHostEnabled(message.host, message.enabled);
    return { ok: true };
  }

  if (message.type === MESSAGE_TYPES.protectText) {
    const settings = await loadSettings();
    const url = new URL(message.url);
    if (!isSiteEnabled(url, settings)) {
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
    return sendToOffscreen(enriched);
  }

  return sendToOffscreen(message);
}

async function sendToOffscreen(message: PromptWardMessage): Promise<unknown> {
  await ensureOffscreenDocument();
  return chrome.runtime.sendMessage(message);
}

async function ensureOffscreenDocument(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)]
  });

  if (contexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: "Runs the local Rampart model worker outside the MV3 service worker lifecycle."
  });
}

async function registerCustomDomainScripts(): Promise<void> {
  const settings = await loadSettings();
  await chrome.scripting.unregisterContentScripts({ ids: ["promptward-custom-domains"] }).catch(() => undefined);
  if (settings.customDomains.length === 0) return;

  const matches = settings.customDomains.map((domain) => {
    const host = domain.trim().toLowerCase().replace(/^\*\./, "");
    return `*://${host}/*`;
  });

  await chrome.scripting.registerContentScripts([
    {
      id: "promptward-custom-domains",
      js: ["src/content.ts"],
      matches,
      runAt: "document_start",
      allFrames: true,
      persistAcrossSessions: true
    }
  ]);
}
