export type ConversationLocation = {
  tabId?: number;
  frameId?: number;
  url: string;
};

export function getConversationKey(location: ConversationLocation): string {
  const parsed = new URL(location.url);
  const tab = typeof location.tabId === "number" ? location.tabId : "unknown-tab";
  const frame = typeof location.frameId === "number" ? location.frameId : "unknown-frame";
  return `${tab}:${frame}:${parsed.origin}:${parsed.pathname}`;
}
