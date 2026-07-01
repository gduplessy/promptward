import { describe, expect, it } from "vitest";
import { computeModelProgress } from "../src/shared/model-progress";
import type { DebugLogInput } from "../src/shared/debug";

function progressEvent(metadata: Record<string, unknown>): DebugLogInput {
  return {
    debugId: "model-load",
    context: "worker",
    stage: "model-load-progress",
    level: "debug",
    metadata
  };
}

describe("computeModelProgress", () => {
  it("returns undefined when no progress events exist", () => {
    expect(computeModelProgress([])).toBeUndefined();
    expect(
      computeModelProgress([
        { debugId: "x", context: "worker", stage: "prewarm-start", level: "debug", metadata: {} }
      ])
    ).toBeUndefined();
  });

  it("weights overall progress by bytes across files", () => {
    const events = [
      progressEvent({ file: "tokenizer.json", loaded: 100, total: 100 }),
      progressEvent({ file: "onnx/model_q4.onnx", loaded: 300, total: 900 })
    ];

    const result = computeModelProgress(events);
    expect(result?.pct).toBe(40);
    expect(result?.file).toBe("onnx/model_q4.onnx");
  });

  it("uses the latest snapshot per file", () => {
    const events = [
      progressEvent({ file: "onnx/model_q4.onnx", loaded: 100, total: 1000 }),
      progressEvent({ file: "onnx/model_q4.onnx", loaded: 800, total: 1000 })
    ];

    expect(computeModelProgress(events)?.pct).toBe(80);
  });

  it("treats done events as fully loaded and clamps at 100", () => {
    const events = [
      progressEvent({ file: "config.json", loaded: 40, total: 50 }),
      progressEvent({ file: "config.json", status: "done" })
    ];

    expect(computeModelProgress(events)?.pct).toBe(100);
  });
});
