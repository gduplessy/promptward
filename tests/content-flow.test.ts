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

function mountRichTextComposer(text: string): { editor: HTMLElement; button: HTMLButtonElement } {
  // Mimics ChatGPT's composer: an earlier empty contenteditable (title/search
  // field) precedes the real prompt textarea div, which exposes role="textbox".
  // The send button is a sibling, not an ancestor of the editor, and is NOT
  // wrapped in a <form> with it. Clicking the button blurs the editor.
  document.body.innerHTML = `
    <div id="sidebar"><div contenteditable="true" role="textbox" aria-label="Search chats"></div></div>
    <main>
      <div id="composer">
        <div id="prompt-textarea" contenteditable="true" role="textbox" aria-label="Chat with ChatGPT">${text}</div>
      </div>
      <button id="composer-submit-button" type="button" data-testid="send-button" aria-label="Send prompt">Send</button>
    </main>`;
  const editor = document.querySelector<HTMLElement>("#prompt-textarea")!;
  editor.focus();
  return { editor, button: document.querySelector("button")! };
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

  it("resolves the composer over an earlier empty contenteditable on rich-text sites", async () => {
    // Mirrors the ChatGPT/Perplexity topology that regressed in 0.10.1: the page
    // contains an empty contenteditable (e.g. a title/search field) that appears
    // BEFORE the real composer in DOM order, and the send button is a sibling of
    // the composer rather than a descendant. At click time document.activeElement
    // has moved off the editor onto the button, so the activeElement fast-path
    // can't rescue the lookup. The adapter must rank candidates and pick the one
    // with text, not the first contenteditable in the document.
    const { button } = mountRichTextComposer("my ssn is 123-45-6789");
    stub.setProtectResponse({
      ok: true,
      safeText: "my ssn is [SSN_1]",
      changed: true,
      placeholders: [{ token: "[SSN_1]", label: "SSN" }],
      durationMs: 1
    });

    const result = clickButton(button);

    // Send must be intercepted (not silently passed through as empty-editor-ignored).
    expect(result.defaultPrevented).toBe(true);
    await vi.waitFor(() => {
      expect(stub.sentMessages.some((m) => m.type === "PW_PROTECT_TEXT")).toBe(true);
    });
    const protectMessage = stub.sentMessages.find((m) => m.type === "PW_PROTECT_TEXT") as
      | { text?: string }
      | undefined;
    expect(protectMessage?.text).toContain("123-45-6789");
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

  it("Enter with isComposing true is not intercepted (IME composition)", async () => {
    const { textarea, form } = mountComposer("hi there");
    stub.setProtectResponse({ ok: true, safeText: "hi [PERSON_1]", changed: true, placeholders: [], durationMs: 1 });

    let submitted = false;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitted = true;
    });

    const keyEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      isComposing: true,
      bubbles: true,
      cancelable: true
    });
    textarea.dispatchEvent(keyEvent);

    expect(keyEvent.defaultPrevented).toBe(false);
    expect(submitted).toBe(false);
    expect(stub.sentMessages.some((m) => m.type === "PW_PROTECT_TEXT")).toBe(false);
    expect(document.querySelector("promptward-review")).toBeNull();
  });

  it("Enter with keyCode 229 is not intercepted (legacy IME signal)", async () => {
    const { textarea, form } = mountComposer("hi there");
    stub.setProtectResponse({ ok: true, safeText: "hi [PERSON_1]", changed: true, placeholders: [], durationMs: 1 });

    let submitted = false;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitted = true;
    });

    const keyEvent = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    Object.defineProperty(keyEvent, "keyCode", { get: () => 229 });
    textarea.dispatchEvent(keyEvent);

    expect(keyEvent.defaultPrevented).toBe(false);
    expect(submitted).toBe(false);
    expect(stub.sentMessages.some((m) => m.type === "PW_PROTECT_TEXT")).toBe(false);
    expect(document.querySelector("promptward-review")).toBeNull();
  });
});

describe("content flow: channel failures fail closed", () => {
  it("an undefined protect response fails closed with feedback", async () => {
    vi.useFakeTimers();
    const { button } = mountComposer("hi there");
    stub.setProtectResponder(() => Promise.resolve(undefined as unknown as import("../src/shared/messages").ProtectTextResponse));

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
    expect(replayed).toBe(false);

    shadow.querySelector<HTMLButtonElement>("[data-action='cancel']")?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(replayed).toBe(false);
  });

  it("a rejected sendMessage fails closed with feedback and no unhandled rejection", async () => {
    vi.useFakeTimers();
    const { button } = mountComposer("hi there");
    stub.setProtectResponder(() => Promise.reject(new Error("Extension context invalidated")));

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
    expect(replayed).toBe(false);

    shadow.querySelector<HTMLButtonElement>("[data-action='cancel']")?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(replayed).toBe(false);
  });
});

describe("error-modal retry", () => {
  it("retry success with changes shows the review modal before sending", async () => {
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

    // The retry result must go through the review modal, not straight to a replay.
    await vi.waitFor(() => {
      expect(getShadow().querySelector("[data-action='original']")).not.toBeNull();
    }, { interval: 1 });
    expect(replayed).toBe(false);

    await vi.advanceTimersByTimeAsync(AUTO_CONFIRM_SECONDS * 1000);

    await vi.waitFor(() => {
      expect(replayed).toBe(true);
    }, { interval: 1 });
    expect(textarea.value).toBe("safe");
  });

  it("retry failure re-shows the error modal instead of failing silently", async () => {
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

    stub.setProtectResponse({ ok: false, safeText: "", changed: false, placeholders: [], durationMs: 1, error: "boom again" });
    getShadow().querySelector<HTMLButtonElement>("[data-action='retry']")?.click();

    // A fresh error modal (Cancel + Retry, no "original" action) must appear - the
    // user is never left with a dead-end modal and no feedback.
    await vi.waitFor(() => {
      const shadow = getShadow();
      expect(shadow.querySelector("[data-action='retry']")).not.toBeNull();
      expect(shadow.querySelector("[data-action='original']")).toBeNull();
    }, { interval: 1 });

    getShadow().querySelector<HTMLButtonElement>("[data-action='cancel']")?.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(replayed).toBe(false);
    expect(textarea.value).toBe("hi there");
  });

  it("retry success with no changes replays without a modal", async () => {
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

    stub.setProtectResponse({ ok: true, safeText: "hi there", changed: false, placeholders: [], durationMs: 1 });
    getShadow().querySelector<HTMLButtonElement>("[data-action='retry']")?.click();

    await vi.waitFor(() => {
      expect(replayed).toBe(true);
    }, { interval: 1 });

    expect(textarea.value).toBe("hi there");
    expect(document.querySelector("promptward-review")).toBeNull();
  });
});
