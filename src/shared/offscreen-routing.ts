import { MESSAGE_TYPES, isPromptWardMessage, type MessageType } from "./messages";

/**
 * Message types the offscreen document actually handles. chrome.runtime.sendMessage
 * broadcasts to every listening page (background service worker and the offscreen
 * document once it exists) except the sender, so the offscreen listener must ignore
 * everything outside this set — otherwise its instant "unsupported" response races
 * background.ts's real, storage-backed answer for types like getDebugLogs and
 * usually wins, corrupting it.
 */
export const OFFSCREEN_MESSAGE_TYPES: ReadonlySet<MessageType> = new Set([
  MESSAGE_TYPES.prewarmModel,
  MESSAGE_TYPES.protectText,
  MESSAGE_TYPES.revealText,
  MESSAGE_TYPES.resetConversation
]);

export function isOffscreenOwnedMessage(message: unknown): boolean {
  return isPromptWardMessage(message) && OFFSCREEN_MESSAGE_TYPES.has(message.type);
}
