import type { PromptWardSettings } from "./messages";

export const DEFAULT_SETTINGS: PromptWardSettings = {
  enabled: true,
  domainOverrides: {},
  customDomains: []
};

export const BUILT_IN_HOSTS = new Set([
  "chatgpt.com",
  "chat.openai.com",
  "claude.ai",
  "gemini.google.com",
  "www.perplexity.ai",
  "chat.mistral.ai"
]);

export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\*\./, "");
}

const HOST_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]?$/;

/** Accepts a bare registrable hostname (post-normalizeHost): no scheme, path,
 *  port, spaces, or IP-literal brackets. Rejects single-label hosts ("localhost"). */
export function isValidCustomHost(host: string): boolean {
  return host.length > 0 && host.length <= 253 && HOST_PATTERN.test(host);
}

export function isSiteEnabled(url: URL, settings: PromptWardSettings): boolean {
  if (!settings.enabled) return false;
  const host = normalizeHost(url.hostname);
  const override = settings.domainOverrides[host];
  if (typeof override === "boolean") return override;
  if (BUILT_IN_HOSTS.has(host)) return true;
  return settings.customDomains.map(normalizeHost).includes(host);
}

export async function loadSettings(): Promise<PromptWardSettings> {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    domainOverrides: {
      ...DEFAULT_SETTINGS.domainOverrides,
      ...(stored.domainOverrides as Record<string, boolean> | undefined)
    },
    customDomains: Array.isArray(stored.customDomains) ? stored.customDomains : []
  };
}

export async function setHostEnabled(host: string, enabled: boolean): Promise<void> {
  const settings = await loadSettings();
  const normalized = normalizeHost(host);
  await chrome.storage.sync.set({
    domainOverrides: {
      ...settings.domainOverrides,
      [normalized]: enabled
    }
  });
}
