import { describe, expect, it } from "vitest";
import { isPromptWardMessage, MESSAGE_TYPES } from "../src/shared/messages";

describe("message validation", () => {
  it("accepts valid protect requests", () => {
    expect(
      isPromptWardMessage({
        type: MESSAGE_TYPES.protectText,
        text: "hello",
        conversationKey: "1:0:https://chatgpt.com:/",
        url: "https://chatgpt.com/"
      })
    ).toBe(true);
  });

  it("rejects oversized prompt payloads", () => {
    expect(
      isPromptWardMessage({
        type: MESSAGE_TYPES.protectText,
        text: "x".repeat(200_001),
        conversationKey: "k",
        url: "https://chatgpt.com/"
      })
    ).toBe(false);
  });

  it("rejects unknown message types", () => {
    expect(isPromptWardMessage({ type: "PW_UNKNOWN" })).toBe(false);
  });
});
