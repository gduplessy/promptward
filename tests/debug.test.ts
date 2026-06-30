import { describe, expect, it } from "vitest";
import { normalizeDebugEvent, textSummary } from "../src/shared/debug";

describe("debug utilities", () => {
  it("summarizes text without returning raw content", async () => {
    const summary = await textSummary("John Smith 123-34-1223");

    expect(summary).toMatchObject({ textLength: 22, hasText: true });
    expect(JSON.stringify(summary)).not.toContain("John");
    expect(summary.textHash).toHaveLength(16);
  });

  it("normalizes debug events with version and ids", () => {
    const event = normalizeDebugEvent({
      debugId: "debug-1",
      context: "content",
      stage: "editor-read",
      level: "debug",
      metadata: { textLength: 10 }
    });

    expect(event.id).toBeTruthy();
    expect(event.version).toBe("0.6.0");
    expect(event.stage).toBe("editor-read");
  });
});
