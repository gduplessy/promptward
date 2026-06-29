import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, isSiteEnabled, normalizeHost } from "../src/shared/settings";

describe("settings domain matching", () => {
  it("enables built-in AI domains by default", () => {
    expect(isSiteEnabled(new URL("https://chatgpt.com/c/1"), DEFAULT_SETTINGS)).toBe(true);
  });

  it("allows explicit domain overrides", () => {
    expect(
      isSiteEnabled(new URL("https://chatgpt.com/"), {
        ...DEFAULT_SETTINGS,
        domainOverrides: { "chatgpt.com": false }
      })
    ).toBe(false);
  });

  it("matches custom domains without granting all URLs by default", () => {
    expect(
      isSiteEnabled(new URL("https://ai.example.com/chat"), {
        ...DEFAULT_SETTINGS,
        customDomains: ["ai.example.com"]
      })
    ).toBe(true);
  });

  it("normalizes wildcard hosts for storage", () => {
    expect(normalizeHost("*.Example.COM ")).toBe("example.com");
  });
});
