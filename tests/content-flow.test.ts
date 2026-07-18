import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installChromeStub, type ChromeStub } from "./helpers/chrome-stub";
import { AUTO_CONFIRM_SECONDS } from "../src/content/review-modal";

let stub: ChromeStub;

beforeAll(async () => {
  stub = installChromeStub();
  await import("../src/content"); // installs capture listeners once
});

afterEach(() => {
  document.body.innerHTML = "";
  document.querySelectorAll("promptward-review").forEach((node) => node.remove());
  vi.useRealTimers();
  stub.setProtectResponse({ ok: true, safeText: "", changed: false, placeholders: [], durationMs: 1 });
  stub.sentMessages.length = 0;
});

function mountComposer(text: string): { textarea: HTMLTextAreaElement; button: HTMLButtonElement; form: HTMLFormElement } {
  document.body.innerHTML = `
    <form>
      <textarea>${text}</textarea>
      <button type="button" aria-label="Send prompt">Send</button>
    </form>`;
  // findEditorIn prefers document.activeElement; focus the textarea like a real user
  const textarea = document.querySelector("textarea")!;
  textarea.focus();
  return { textarea, button: document.querySelector("button")!, form: document.querySelector("form")! };
}

function getShadow(): ShadowRoot {
  const host = document.querySelector("promptward-review");
  if (!host?.shadowRoot) throw new Error("Review modal not mounted");
  return host.shadowRoot;
}

function clickButton(button: HTMLButtonElement): { defaultPrevented: boolean } {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  button.dispatchEvent(event);
  return { defaultPrevented: event.defaultPrevented };
}

describe("content flow: click-to-send happy path", () => {
  it("replays unchanged text without showing a modal", async () => {
    const { button } = mountComposer("hello");
    stub.setProtectResponse({ ok: true, safeText: "hello", changed: false, placeholders: [], durationMs: 1 });

    // The document-level capture listener calls stopImmediatePropagation() on the
    // original click, so a bubble-phase listener on the button never sees that first
    // event at all — check its defaultPrevented flag directly on the dispatched event
    // instead. The replay click (triggered by trigger.click() inside replay()) is not
    // intercepted, so it does reach this listener.
    let replayed = false;
    button.addEventListener("click", (event) => {
      if (!event.defaultPrevented) replayed = true;
    });

    const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    button.dispatchEvent(clickEvent);
    expect(clickEvent.defaultPrevented).toBe(true); // intercepted

    await vi.waitFor(() => {
      expect(replayed).toBe(true); // replay passing through
    });

    expect(document.querySelector("promptward-review")).toBeNull();
  });
});

describe("content flow: review-modal decisions", () => {
  it("shows the modal on changed text and auto-confirms the redacted text when idle", async () => {
    vi.useFakeTimers();
    const { textarea, button } = mountComposer("hi there");
    stub.setProtectResponse({ ok: true, safeText: "hi [PERSON_1]", changed: true, placeholders: [], durationMs: 1 });

    let replayed = false;
    button.addEventListener("click", (event) => {
      if (!event.defaultPrevented) replayed = true;
    });

    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      expect(document.querySelector("promptward-review")).not.toBeNull();
    }, { interval: 1 });

    await vi.advanceTimersByTimeAsync(AUTO_CONFIRM_SECONDS * 1000);

    // The auto-confirm -> setText -> replay chain crosses several real (non-fake-timer)
    // await points (editor.setText, textSummary, chrome.runtime.sendMessage for debug
    // logs), so a single advanceTimersByTimeAsync call doesn't necessarily drain all of
    // them; wait for the flag to flip rather than asserting immediately after.
    await vi.waitFor(() => {
      expect(replayed).toBe(true);
    }, { interval: 1 });
    expect(textarea.value).toBe("hi [PERSON_1]");
  });

  it("cancel restores the original text and does not send", async () => {
    vi.useFakeTimers();
    const { textarea, button } = mountComposer("hi there");
    stub.setProtectResponse({ ok: true, safeText: "hi [PERSON_1]", changed: true, placeholders: [], durationMs: 1 });

    let replayed = false;
    button.addEventListener("click", (event) => {
      if (!event.defaultPrevented) replayed = true;
    });

    const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    button.dispatchEvent(clickEvent);
    expect(clickEvent.defaultPrevented).toBe(true); // intercepted

    await vi.waitFor(() => {
      expect(document.querySelector("promptward-review")).not.toBeNull();
    }, { interval: 1 });

    getShadow().querySelector<HTMLButtonElement>("[data-action='cancel']")?.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(textarea.value).toBe("hi there");
    expect(replayed).toBe(false); // no replay
  });

  it("send original restores the original text and replays", async () => {
    vi.useFakeTimers();
    const { textarea, button } = mountComposer("hi there");
    stub.setProtectResponse({ ok: true, safeText: "hi [PERSON_1]", changed: true, placeholders: [], durationMs: 1 });

    let replayed = false;
    button.addEventListener("click", (event) => {
      if (!event.defaultPrevented) replayed = true;
    });

    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => {
      expect(document.querySelector("promptward-review")).not.toBeNull();
    }, { interval: 1 });

    getShadow().querySelector<HTMLButtonElement>("[data-action='original']")?.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(textarea.value).toBe("hi there");
    expect(replayed).toBe(true);
  });

  it("protect failure shows an error modal with no auto-send", async () => {
    vi.useFakeTimers();
    const { button } = mountComposer("hi there");
    stub.setProtectResponse({ ok: false, safeText: "", changed: false, placeholders: [], durationMs: 1, error: "boom" });

    let replayed = false;
    button.addEventListener("click", (event) => {
      if (!event.defaultPrevented) replayed = true;
    });

    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => {
      expect(document.querySelector("promptward-review")).not.toBeNull();
    }, { interval: 1 });

    const shadow = getShadow();
    expect(shadow.querySelector("[data-action='original']")).toBeNull();

    await vi.advanceTimersByTimeAsync(AUTO_CONFIRM_SECONDS * 2 * 1000);
    expect(replayed).toBe(false);

    shadow.querySelector<HTMLButtonElement>("[data-action='cancel']")?.click();
    await vi.advanceTimersByTimeAsync(0);
  });
});

describe("content flow: guard behavior", () => {
  it("fails closed when the redacted text doesn't stick, and shows a follow-up error modal", async () => {
    vi.useFakeTimers();
    const { textarea, button } = mountComposer("hi there");
    Object.defineProperty(textarea, "value", {
      get: () => "original text",
      set: () => {
        /* editor rejects writes */
      }
    });
    stub.setProtectResponse({ ok: true, safeText: "hi [PERSON_1]", changed: true, placeholders: [], durationMs: 1 });

    let replayed = false;
    button.addEventListener("click", (event) => {
      if (!event.defaultPrevented) replayed = true;
    });

    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => {
      expect(document.querySelector("promptward-review")).not.toBeNull();
    }, { interval: 1 });

    await vi.advanceTimersByTimeAsync(AUTO_CONFIRM_SECONDS * 1000);

    // A follow-up error modal should now be mounted (the "couldn't confirm" guard).
    await vi.waitFor(() => {
      expect(document.querySelector("promptward-review")).not.toBeNull();
    }, { interval: 1 });

    expect(replayed).toBe(false);
    const shadow = getShadow();
    expect(shadow.textContent).toContain("couldn't confirm the redacted text");
  });

  it("ignores an empty editor", async () => {
    const { button } = mountComposer("");

    const result = clickButton(button);

    expect(result.defaultPrevented).toBe(false);
    expect(stub.sentMessages.some((m) => m.type === "PW_PROTECT_TEXT")).toBe(false);
  });

  it("swallows an in-flight duplicate send", async () => {
    const { button } = mountComposer("hi there");
    let resolveProtect: (response: import("../src/shared/messages").ProtectTextResponse) => void = () => undefined;
    stub.setProtectResponder(
      () =>
        new Promise((resolve) => {
          resolveProtect = resolve;
        })
    );

    const firstEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    button.dispatchEvent(firstEvent);

    // Let the microtask queue advance so inFlight gets set before the second click.
    await vi.waitFor(() => {
      expect(stub.sentMessages.some((m) => m.type === "PW_PROTECT_TEXT")).toBe(true);
    });

    const secondEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    button.dispatchEvent(secondEvent);

    expect(secondEvent.defaultPrevented).toBe(true);
    expect(stub.sentMessages.filter((m) => m.type === "PW_PROTECT_TEXT").length).toBe(1);

    resolveProtect({ ok: true, safeText: "hi there", changed: false, placeholders: [], durationMs: 1 });
    await vi.waitFor(() => {
      // flow completes without throwing; nothing further to assert here beyond stability
      expect(stub.sentMessages.filter((m) => m.type === "PW_PROTECT_TEXT").length).toBe(1);
    });
  });

  it("Enter key in the editor triggers the flow", async () => {
    const { textarea, form } = mountComposer("hi there");
    stub.setProtectResponse({ ok: true, safeText: "hi there", changed: false, placeholders: [], durationMs: 1 });

    let submitted = false;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitted = true;
    });

    const keyEvent = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    textarea.dispatchEvent(keyEvent);

    expect(keyEvent.defaultPrevented).toBe(true);

    await vi.waitFor(() => {
      expect(submitted).toBe(true);
    });
  });
});

describe("error-modal retry (current behavior — see plans/003)", () => {
  it("a successful retry replays without re-showing the review modal", async () => {
    vi.useFakeTimers();
    const { textarea, button } = mountComposer("hi there");
    stub.setProtectResponse({ ok: false, safeText: "", changed: false, placeholders: [], durationMs: 1, error: "boom" });

    let replayed = false;
    button.addEventListener("click", (event) => {
      if (!event.defaultPrevented) replayed = true;
    });

    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => {
      expect(document.querySelector("promptward-review")).not.toBeNull();
    }, { interval: 1 });

    stub.setProtectResponse({ ok: true, safeText: "safe", changed: true, placeholders: [], durationMs: 1 });
    getShadow().querySelector<HTMLButtonElement>("[data-action='retry']")?.click();

    await vi.waitFor(() => {
      expect(textarea.value).toBe("safe");
    }, { interval: 1 });

    // Plan 003 intentionally changes this: retry success must re-show the review modal.
    expect(replayed).toBe(true);
    expect(document.querySelector("promptward-review")).toBeNull();
  });
});
