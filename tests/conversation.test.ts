import { describe, expect, it } from "vitest";
import { getConversationKey } from "../src/shared/conversation";

describe("conversation key", () => {
  it("uses tab, frame, origin, and pathname", () => {
    expect(getConversationKey({ tabId: 4, frameId: 0, url: "https://chatgpt.com/c/thread?x=1" })).toBe(
      "4:0:https://chatgpt.com:/c/thread"
    );
  });
});
