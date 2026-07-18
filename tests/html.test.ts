import { describe, expect, it } from "vitest";
import { escapeHtml } from "../src/shared/html";

describe("escapeHtml", () => {
  it("escapes all five special characters", () => {
    const input = `<img src=x onerror="a&b('c')">`;
    const output = escapeHtml(input);

    expect(output).not.toContain("<");
    expect(output).not.toContain(">");
    expect(output).not.toContain('"');
    expect(output).not.toContain("'");
    expect(output).not.toMatch(/&(?!amp;|lt;|gt;|quot;|#39;)/);
  });

  it("round-trips safely through innerHTML", () => {
    const input = `<img src=x onerror="a&b('c')">`;
    const escaped = escapeHtml(input);

    const div = document.createElement("div");
    div.innerHTML = escaped;

    expect(div.textContent).toBe(input);
    expect(div.querySelector("img")).toBeNull();
  });

  it("leaves plain text untouched", () => {
    const input = "Just some plain text, with punctuation.";
    expect(escapeHtml(input)).toBe(input);
  });
});
