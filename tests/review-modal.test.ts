import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTO_CONFIRM_SECONDS, showReviewModal, type ReviewDecision } from "../src/content/review-modal";

describe("review modal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll("promptward-review").forEach((node) => node.remove());
  });

  function trackDecision(promise: Promise<ReviewDecision>): { decision: ReviewDecision | undefined } {
    const state: { decision: ReviewDecision | undefined } = { decision: undefined };
    void promise.then((value) => {
      state.decision = value;
    });
    return state;
  }

  function getShadow(): ShadowRoot {
    const host = document.querySelector("promptward-review");
    if (!host?.shadowRoot) throw new Error("Review modal not mounted");
    return host.shadowRoot;
  }

  it("auto-confirms the redacted prompt after the countdown when the user is idle", async () => {
    const state = trackDecision(showReviewModal({ original: "hello", redacted: "hi" }));

    await vi.advanceTimersByTimeAsync(AUTO_CONFIRM_SECONDS * 1000);

    expect(state.decision).toBe("confirm");
    expect(document.querySelector("promptward-review")).toBeNull();
  });

  it("shows the remaining seconds on the confirm button", async () => {
    void showReviewModal({ original: "hello", redacted: "hi" });
    const button = getShadow().querySelector<HTMLButtonElement>("[data-action='confirm']");

    expect(button?.textContent).toBe(`Send redacted (${AUTO_CONFIRM_SECONDS}s)`);
    await vi.advanceTimersByTimeAsync(1000);
    expect(button?.textContent).toBe(`Send redacted (${AUTO_CONFIRM_SECONDS - 1}s)`);
  });

  it("cancels the countdown when the user interacts with the modal", async () => {
    const state = trackDecision(showReviewModal({ original: "hello", redacted: "hi" }));
    const shadow = getShadow();

    shadow.querySelector(".backdrop")?.dispatchEvent(new Event("pointermove", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(AUTO_CONFIRM_SECONDS * 2 * 1000);

    expect(state.decision).toBeUndefined();
    const button = shadow.querySelector<HTMLButtonElement>("[data-action='confirm']");
    expect(button?.textContent).toBe("Send redacted");
  });

  it("resolves original when the user chooses to send unredacted text", async () => {
    const state = trackDecision(showReviewModal({ original: "hello", redacted: "hi" }));

    getShadow().querySelector<HTMLButtonElement>("[data-action='original']")?.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(state.decision).toBe("original");
  });

  it("resolves cancel and stops the countdown", async () => {
    const state = trackDecision(showReviewModal({ original: "hello", redacted: "hi" }));

    getShadow().querySelector<HTMLButtonElement>("[data-action='cancel']")?.click();
    await vi.advanceTimersByTimeAsync(AUTO_CONFIRM_SECONDS * 1000);

    expect(state.decision).toBe("cancel");
  });

  it("never auto-sends from the error modal", async () => {
    const state = trackDecision(showReviewModal({ original: "hello", error: "boom" }));

    await vi.advanceTimersByTimeAsync(AUTO_CONFIRM_SECONDS * 2 * 1000);

    expect(state.decision).toBeUndefined();
    expect(getShadow().querySelector("[data-action='original']")).toBeNull();
  });
});
