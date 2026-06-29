export const MESSAGE_TYPES = {
  prewarmModel: "PW_PREWARM_MODEL",
  protectText: "PW_PROTECT_TEXT",
  revealText: "PW_REVEAL_TEXT",
  getSettings: "PW_GET_SETTINGS",
  setSiteEnabled: "PW_SET_SITE_ENABLED",
  resetConversation: "PW_RESET_CONVERSATION"
} as const;

export type MessageType = (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];

export type PlaceholderSummary = {
  token: string;
  label: string;
};

export type PromptWardSettings = {
  enabled: boolean;
  domainOverrides: Record<string, boolean>;
  customDomains: string[];
  webGpuEnabled: boolean;
};

export type PrewarmModelMessage = {
  type: typeof MESSAGE_TYPES.prewarmModel;
};

export type ProtectTextMessage = {
  type: typeof MESSAGE_TYPES.protectText;
  text: string;
  conversationKey: string;
  url: string;
};

export type RevealTextMessage = {
  type: typeof MESSAGE_TYPES.revealText;
  text: string;
  conversationKey: string;
};

export type GetSettingsMessage = {
  type: typeof MESSAGE_TYPES.getSettings;
};

export type SetSiteEnabledMessage = {
  type: typeof MESSAGE_TYPES.setSiteEnabled;
  host: string;
  enabled: boolean;
};

export type ResetConversationMessage = {
  type: typeof MESSAGE_TYPES.resetConversation;
  conversationKey: string;
};

export type PromptWardMessage =
  | PrewarmModelMessage
  | ProtectTextMessage
  | RevealTextMessage
  | GetSettingsMessage
  | SetSiteEnabledMessage
  | ResetConversationMessage;

export type PrewarmModelResponse = {
  ok: boolean;
  status: "ready" | "loading" | "error";
  coldStartMs?: number;
  error?: string;
};

export type ProtectTextResponse = {
  ok: boolean;
  safeText: string;
  changed: boolean;
  placeholders: PlaceholderSummary[];
  durationMs: number;
  error?: string;
};

export type RevealTextResponse = {
  ok: boolean;
  text: string;
  error?: string;
};

export type SetSiteEnabledResponse = {
  ok: boolean;
};

export function isPromptWardMessage(value: unknown): value is PromptWardMessage {
  if (!value || typeof value !== "object") return false;
  const maybe = value as Record<string, unknown>;
  if (typeof maybe.type !== "string") return false;

  switch (maybe.type) {
    case MESSAGE_TYPES.prewarmModel:
    case MESSAGE_TYPES.getSettings:
      return true;
    case MESSAGE_TYPES.protectText:
      return (
        typeof maybe.text === "string" &&
        maybe.text.length <= 200_000 &&
        typeof maybe.conversationKey === "string" &&
        maybe.conversationKey.length > 0 &&
        maybe.conversationKey.length <= 500 &&
        typeof maybe.url === "string"
      );
    case MESSAGE_TYPES.revealText:
      return (
        typeof maybe.text === "string" &&
        typeof maybe.conversationKey === "string" &&
        maybe.conversationKey.length > 0 &&
        maybe.conversationKey.length <= 500
      );
    case MESSAGE_TYPES.setSiteEnabled:
      return typeof maybe.host === "string" && typeof maybe.enabled === "boolean";
    case MESSAGE_TYPES.resetConversation:
      return typeof maybe.conversationKey === "string" && maybe.conversationKey.length > 0;
    default:
      return false;
  }
}
