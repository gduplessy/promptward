import { describe, expect, it } from "vitest";
import { MESSAGE_TYPES } from "../src/shared/messages";
import { isOffscreenOwnedMessage, OFFSCREEN_MESSAGE_TYPES } from "../src/shared/offscreen-routing";

describe("offscreen message ownership", () => {
  it("owns exactly the offscreen worker message types", () => {
    expect([...OFFSCREEN_MESSAGE_TYPES].sort()).toEqual(
      [
        MESSAGE_TYPES.prewarmModel,
        MESSAGE_TYPES.protectText,
        MESSAGE_TYPES.revealText,
        MESSAGE_TYPES.resetConversation
      ].sort()
    );
  });

  it("claims prewarm/protect/reveal/reset messages", () => {
    expect(isOffscreenOwnedMessage({ type: MESSAGE_TYPES.prewarmModel })).toBe(true);
    expect(
      isOffscreenOwnedMessage({
        type: MESSAGE_TYPES.protectText,
        text: "hi",
        conversationKey: "1:0:https://chatgpt.com:/",
        url: "https://chatgpt.com/"
      })
    ).toBe(true);
    expect(
      isOffscreenOwnedMessage({ type: MESSAGE_TYPES.revealText, text: "hi", conversationKey: "k" })
    ).toBe(true);
    expect(isOffscreenOwnedMessage({ type: MESSAGE_TYPES.resetConversation, conversationKey: "k" })).toBe(true);
  });

  it("does not claim background-owned messages, preventing the getDebugLogs race", () => {
    expect(isOffscreenOwnedMessage({ type: MESSAGE_TYPES.getDebugLogs })).toBe(false);
    expect(isOffscreenOwnedMessage({ type: MESSAGE_TYPES.getSettings })).toBe(false);
    expect(isOffscreenOwnedMessage({ type: MESSAGE_TYPES.getDebugSettings })).toBe(false);
    expect(isOffscreenOwnedMessage({ type: MESSAGE_TYPES.setSiteEnabled, host: "chatgpt.com", enabled: true })).toBe(
      false
    );
    expect(
      isOffscreenOwnedMessage({
        type: MESSAGE_TYPES.debugLog,
        event: { debugId: "d", context: "content", stage: "s", level: "debug", metadata: {} }
      })
    ).toBe(false);
    expect(isOffscreenOwnedMessage({ type: MESSAGE_TYPES.clearDebugLogs })).toBe(false);
    expect(isOffscreenOwnedMessage({ type: MESSAGE_TYPES.setDebugSettings, rawDiagnosticsEnabled: true })).toBe(
      false
    );
  });

  it("rejects invalid or unknown messages", () => {
    expect(isOffscreenOwnedMessage(undefined)).toBe(false);
    expect(isOffscreenOwnedMessage({ type: "PW_UNKNOWN" })).toBe(false);
  });
});
