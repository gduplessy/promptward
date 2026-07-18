import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, isSiteEnabled, isValidCustomHost, normalizeHost } from "../src/shared/settings";

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

describe("isValidCustomHost", () => {
  it("accepts well-formed hostnames", () => {
    expect(isValidCustomHost("example.com")).toBe(true);
    expect(isValidCustomHost("ai.example.co.uk")).toBe(true);
    expect(isValidCustomHost("my-app.example.io")).toBe(true);
    expect(isValidCustomHost("chat.example123.com")).toBe(true);
  });

  it("rejects empty input", () => {
    expect(isValidCustomHost("")).toBe(false);
  });

  it("rejects single-label hosts", () => {
    expect(isValidCustomHost("localhost")).toBe(false);
  });

  it("rejects a host with a path", () => {
    expect(isValidCustomHost("example.com/chat")).toBe(false);
  });

  it("rejects a host with a scheme", () => {
    expect(isValidCustomHost("https://example.com")).toBe(false);
  });

  it("rejects a host with a space", () => {
    expect(isValidCustomHost("foo bar.com")).toBe(false);
  });

  it("rejects a host with an empty label", () => {
    expect(isValidCustomHost("example..com")).toBe(false);
  });

  it("rejects a host with a leading hyphen label", () => {
    expect(isValidCustomHost("-bad.example.com")).toBe(false);
  });

  it("rejects a host with a port", () => {
    expect(isValidCustomHost("example.com:8080")).toBe(false);
  });

  it("rejects an overlong host", () => {
    const longHost = `${"a".repeat(256)}.com`;
    expect(longHost.length).toBeGreaterThan(253);
    expect(isValidCustomHost(longHost)).toBe(false);
  });

  it("rejects unicode hostnames (punycode conversion is out of scope)", () => {
    expect(isValidCustomHost("例え.jp")).toBe(false);
  });

  it("accepts the normalizeHost -> isValidCustomHost pipeline used by the side panel", () => {
    expect(isValidCustomHost(normalizeHost("*.Example.COM "))).toBe(true);
  });
});
