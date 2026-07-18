import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTimeout } from "../src/shared/timeout";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("withTimeout", () => {
  it("resolves with the value when the promise settles before the deadline", async () => {
    const promise = withTimeout(Promise.resolve("value"), 1000, () => "fallback");
    await vi.advanceTimersByTimeAsync(0);
    await expect(promise).resolves.toBe("value");
  });

  it("resolves with the fallback value when the deadline passes first", async () => {
    let resolveInner: (value: string) => void = () => undefined;
    const inner = new Promise<string>((resolve) => {
      resolveInner = resolve;
    });
    const promise = withTimeout(inner, 1000, () => "fallback");

    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toBe("fallback");

    // A late resolution of the inner promise must not throw or change the outcome.
    resolveInner("too-late");
    await vi.advanceTimersByTimeAsync(0);
  });

  it("propagates rejection from the inner promise", async () => {
    const promise = withTimeout(Promise.reject(new Error("boom")), 1000, () => "fallback");
    await expect(promise).rejects.toThrow("boom");
  });

  it("clears the timer once the inner promise settles, so the fallback never fires late", async () => {
    const fallback = vi.fn(() => "fallback");
    const promise = withTimeout(Promise.resolve("value"), 1000, fallback);
    await expect(promise).resolves.toBe("value");

    await vi.advanceTimersByTimeAsync(2000);
    expect(fallback).not.toHaveBeenCalled();
  });
});
