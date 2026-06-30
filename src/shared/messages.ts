import type { DebugLogInput, DebugSettings } from "./debug";

export const MESSAGE_TYPES = {
  prewarmModel: "PW_PREWARM_MODEL",
  protectText: "PW_PROTECT_TEXT",
  revealText: "PW_REVEAL_TEXT",
  getSettings: "PW_GET_SETTINGS",
  setSiteEnabled: "PW_SET_SITE_ENABLED",
  resetConversation: "PW_RESET_CONVERSATION",
  debugLog: "PW_DEBUG_LOG",
  getDebugLogs: "PW_GET_DEBUG_LOGS",
  clearDebugLogs: "PW_CLEAR_DEBUG_LOGS",
  getDebugSettings: "PW_GET_DEBUG_SETTINGS",
  setDebugSettings: "PW_SET_DEBUG_SETTINGS"
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
  debugId?: string;
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

export type DebugLogMessage = {
  type: typeof MESSAGE_TYPES.debugLog;
  event: DebugLogInput;
};

export type GetDebugLogsMessage = {
  type: typeof MESSAGE_TYPES.getDebugLogs;
};

export type ClearDebugLogsMessage = {
  type: typeof MESSAGE_TYPES.clearDebugLogs;
};

export type GetDebugSettingsMessage = {
  type: typeof MESSAGE_TYPES.getDebugSettings;
};

export type SetDebugSettingsMessage = {
  type: typeof MESSAGE_TYPES.setDebugSettings;
  rawDiagnosticsEnabled: boolean;
};

export type PromptWardMessage =
  | PrewarmModelMessage
  | ProtectTextMessage
  | RevealTextMessage
  | GetSettingsMessage
  | SetSiteEnabledMessage
  | ResetConversationMessage
  | DebugLogMessage
  | GetDebugLogsMessage
  | ClearDebugLogsMessage
  | GetDebugSettingsMessage
  | SetDebugSettingsMessage;

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

export type DebugLogsResponse = {
  ok: boolean;
  events: DebugLogInput[];
};

export type DebugSettingsResponse = DebugSettings;

export function isPromptWardMessage(value: unknown): value is PromptWardMessage {
  if (!value || typeof value !== "object") return false;
  const maybe = value as Record<string, unknown>;
  if (typeof maybe.type !== "string") return false;

  switch (maybe.type) {
    case MESSAGE_TYPES.prewarmModel:
    case MESSAGE_TYPES.getSettings:
    case MESSAGE_TYPES.getDebugLogs:
    case MESSAGE_TYPES.clearDebugLogs:
    case MESSAGE_TYPES.getDebugSettings:
      return true;
    case MESSAGE_TYPES.protectText:
      return (
        typeof maybe.text === "string" &&
        maybe.text.length <= 200_000 &&
        typeof maybe.conversationKey === "string" &&
        maybe.conversationKey.length > 0 &&
        maybe.conversationKey.length <= 500 &&
        typeof maybe.url === "string" &&
        (maybe.debugId === undefined || typeof maybe.debugId === "string")
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
    case MESSAGE_TYPES.debugLog:
      return isDebugLogInput(maybe.event);
    case MESSAGE_TYPES.setDebugSettings:
      return typeof maybe.rawDiagnosticsEnabled === "boolean";
    default:
      return false;
  }
}

function isDebugLogInput(value: unknown): value is DebugLogInput {
  if (!value || typeof value !== "object") return false;
  const maybe = value as Record<string, unknown>;
  return (
    typeof maybe.debugId === "string" &&
    typeof maybe.context === "string" &&
    typeof maybe.stage === "string" &&
    typeof maybe.level === "string" &&
    typeof maybe.metadata === "object" &&
    maybe.metadata !== null
  );
}
