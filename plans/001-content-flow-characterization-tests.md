# Plan 001: Add characterization tests for the content-script protection flow

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a6293e1..HEAD -- src/content.ts src/content/ tests/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (tests only; no production code changes)
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `a6293e1`, 2026-07-17

## Why this matters

PromptWard is a Chrome MV3 extension that intercepts the "send" action on AI
chat sites (ChatGPT, Claude, etc.), redacts PII locally, and replays the send.
The orchestration of that entire safety contract lives in
`src/content.ts` (`protectAndMaybeSubmit`, `handleFailure`, `replay`), and it
has **zero test coverage** — the 12 existing test files cover leaf utilities
only. Three follow-up plans (002 IME fix, 003 retry-flow fix, 004 timeouts)
will modify this exact code; without characterization tests first, they land
blind on the most safety-critical file in the repo. This plan adds an
integration-style test suite that drives the real event listeners through a
stubbed `chrome` global, freezing today's behavior — including behavior that
later plans will deliberately change.

## Current state

- `src/content.ts` — the content script. At import time it installs three
  capture-phase listeners and logs an init event (lines 11–19):

  ```ts
  // src/content.ts:11-13
  document.addEventListener("click", onClickCapture, true);
  document.addEventListener("keydown", onKeydownCapture, true);
  document.addEventListener("submit", onSubmitCapture, true);
  ```

  The core flow (`protectAndMaybeSubmit`, lines 88–234) does, in order:
  1. Returns early if no editor found, or if `replaying` WeakSet contains the
     trigger (that's a replayed send passing through), or blocks the event if
     `inFlight` has the trigger, or returns if editor text is empty.
  2. Otherwise calls `event.preventDefault()` + `event.stopImmediatePropagation()`,
     sends a `PW_PROTECT_TEXT` message via `chrome.runtime.sendMessage`.
  3. On `response.ok && !response.changed` → `replay(trigger)` with no modal.
  4. On `response.ok && response.changed` → shows the review modal
     (`showReviewModal` from `src/content/review-modal.ts`); decision
     `"confirm"` → `editor.setText(redacted)`, verify it took (`applied`), then
     replay; if `!applied` → restore original, show error modal, **no send**
     (fail-closed). Decision `"original"` → restore original text, replay.
     Decision `"cancel"` → restore original, no send.
  5. On `!response.ok` → `handleFailure` shows an error modal with a Retry
     button (lines 252–271 — note: today, a successful retry replays
     **without** re-showing the review modal; plan 003 changes this, so the
     characterization test for it must be easy to update).
- `replay()` (lines 283–292) adds the trigger to the `replaying` WeakSet and
  calls `submitNative(trigger)` (`src/content/dom-adapter.ts:153-171`), which
  for a button calls `.click()` and for an editor element falls back to
  `closest("form").requestSubmit()`.
- `src/content/review-modal.ts` — appends a `<promptward-review>` host with a
  shadow root to `document.documentElement`. Auto-confirms after
  `AUTO_CONFIRM_SECONDS` (5) seconds via `setInterval`; any
  `pointermove`/`pointerdown`/`keydown` inside the shadow cancels the
  countdown. Existing tests: `tests/review-modal.test.ts` (use as the pattern
  for fake timers and shadow-root querying).
- `src/content.ts:294-315` — every stage calls `logDebug`, which calls
  `chrome.runtime.sendMessage({ type: "PW_DEBUG_LOG", ... })` and (once, cached)
  `{ type: "PW_GET_DEBUG_SETTINGS" }`. Your chrome stub must answer both.
- Message contract: `src/shared/messages.ts`. `ProtectTextResponse` is
  `{ ok, safeText, changed, placeholders, durationMs, error? }`.
- Test conventions: vitest with `globals: true` and `environment: "jsdom"`
  (`vitest.config.ts`), files in `tests/*.test.ts`, `describe`/`it`/`expect`
  without imports of the runner (they import from "vitest" explicitly — match
  that). `restoreMocks: true` is set globally.

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Install   | `npm install`                        | exit 0              |
| Typecheck | `npx tsc -p tsconfig.json --noEmit`  | exit 0, no output   |
| All tests | `npm test`                           | 12+ files, all pass |
| One file  | `npx vitest run tests/content-flow.test.ts` | all pass     |

## Scope

**In scope** (the only files you should create/modify):
- `tests/content-flow.test.ts` (create)
- `tests/helpers/chrome-stub.ts` (create)

**Out of scope** (do NOT touch):
- `src/content.ts` and everything under `src/` — this plan is tests-only.
  If you feel a production change is needed to make something testable, STOP.
- `vitest.config.ts`, `tsconfig.json` — the existing config already picks up
  `tests/**/*.test.ts`; helper files that don't match `*.test.ts` are not
  collected as suites, which is what we want.

## Git workflow

- Branch: `advisor/001-content-flow-tests`
- Commit style: conventional commits, e.g. `test(content): characterize protection flow` (repo examples: `chore: update gitignore`, `feat(video): add promptward intro`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create the chrome stub helper

Create `tests/helpers/chrome-stub.ts`. It must be installed on `globalThis`
**before** `src/content.ts` is imported (the module calls
`chrome.runtime.sendMessage` at import time). Shape:

```ts
import { vi } from "vitest";
import type { ProtectTextResponse } from "../../src/shared/messages";

export type ChromeStub = {
  chrome: { runtime: { sendMessage: ReturnType<typeof vi.fn> } };
  /** Queue the response for the next PW_PROTECT_TEXT message. */
  setProtectResponse(response: ProtectTextResponse): void;
  sentMessages: Array<Record<string, unknown>>;
};

export function installChromeStub(): ChromeStub {
  const sentMessages: Array<Record<string, unknown>> = [];
  let protectResponse: ProtectTextResponse = {
    ok: true, safeText: "", changed: false, placeholders: [], durationMs: 1
  };
  const sendMessage = vi.fn(async (message: Record<string, unknown>) => {
    sentMessages.push(message);
    switch (message.type) {
      case "PW_GET_DEBUG_SETTINGS": return { rawDiagnosticsEnabled: false };
      case "PW_DEBUG_LOG": return { ok: true };
      case "PW_PROTECT_TEXT": return protectResponse;
      default: return { ok: true };
    }
  });
  const stub = { runtime: { sendMessage } };
  vi.stubGlobal("chrome", stub);
  return {
    chrome: stub,
    setProtectResponse: (r) => { protectResponse = r; },
    sentMessages
  };
}
```

(Adjust typing as needed to satisfy strict TS — `as unknown as typeof chrome`
is acceptable here; this is a test double, and the repo has no lint rule
against it in tests.)

**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0.

### Step 2: Create the test file skeleton with one happy-path test

Create `tests/content-flow.test.ts`. Structure:

```ts
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installChromeStub, type ChromeStub } from "./helpers/chrome-stub";
import { AUTO_CONFIRM_SECONDS } from "../src/content/review-modal";

let stub: ChromeStub;

beforeAll(async () => {
  stub = installChromeStub();
  await import("../src/content"); // installs capture listeners once
});
```

Because the module import (and its listeners) persist for the whole file,
reset per test in `afterEach`: clear `document.body`, remove any
`promptward-review` hosts, `vi.useRealTimers()`, and reinstall the protect
response to a default. Do NOT try to re-import the module.

DOM fixture helper (used by most tests):

```ts
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
```

Note the button is `type="button"` deliberately — a `type="submit"` button
would ALSO fire the form `submit` capture listener and double-drive the flow.
Clicks must be dispatched as `new MouseEvent("click", { bubbles: true, cancelable: true })`
on the button.

First test — **unchanged text replays without a modal**:
- Mount composer with `"hello"`, set protect response
  `{ ok: true, safeText: "hello", changed: false, placeholders: [], durationMs: 1 }`.
- Record clicks on the button with a bubble-phase listener capturing
  `event.defaultPrevented`.
- Dispatch a click; `await vi.waitFor(...)` until two click events were seen.
- Assert: first click `defaultPrevented === true` (intercepted), second click
  `defaultPrevented === false` (the replay passing through), and no
  `promptward-review` element ever appeared.

**Verify**: `npx vitest run tests/content-flow.test.ts` → 1 test passes.

### Step 3: Add the review-modal decision tests

Use `vi.useFakeTimers()` (pattern: `tests/review-modal.test.ts`). With fake
timers, drive async progress with `await vi.advanceTimersByTimeAsync(0)` after
dispatching, since the flow awaits several promises before the modal mounts.

1. **Changed text shows the modal; idle auto-confirm sends redacted**: protect
   response `changed: true, safeText: "hi [PERSON_1]"`. Dispatch click →
   advance timers by 0 until `document.querySelector("promptward-review")`
   exists → advance by `AUTO_CONFIRM_SECONDS * 1000` → assert textarea value
   is now `"hi [PERSON_1]"` and a second (unprevented) click occurred.
2. **Cancel restores original and does not send**: click the
   `[data-action='cancel']` button inside the shadow root → assert textarea
   value is the original and only one click event total (no replay).
3. **Send original**: click `[data-action='original']` → textarea value is the
   original AND a replay click occurred.
4. **Protect failure shows error modal, no auto-send**: protect response
   `{ ok: false, ... error: "boom" }` → modal appears with no
   `[data-action='original']` button (error variant), advance
   `AUTO_CONFIRM_SECONDS * 2 * 1000` → no replay click ever happens.
   Then click `[data-action='cancel']` to clean up.

**Verify**: `npx vitest run tests/content-flow.test.ts` → 5 tests pass.

### Step 4: Add the guard-behavior tests

1. **Fail-closed when redacted text does not stick**: mount the composer, then
   override the textarea's value setter to a no-op so `setText` readback fails:

   ```ts
   Object.defineProperty(textarea, "value", {
     get: () => "original text", set: () => { /* editor rejects writes */ }
   });
   ```

   Protect response `changed: true`. Auto-confirm the modal. Assert: NO replay
   click occurs, and a second `promptward-review` modal appears whose shadow
   contains the text `"couldn't confirm the redacted text"`. (This is the
   fail-closed guard at `src/content.ts:200-211`.)
2. **Empty editor is ignored**: mount composer with `""` → dispatch click →
   assert `defaultPrevented === false` on that click and no `PW_PROTECT_TEXT`
   message in `stub.sentMessages`.
3. **In-flight duplicate send is swallowed**: make the protect response hang
   (a promise you resolve manually). Dispatch click twice; assert the second
   click was `defaultPrevented` and only ONE `PW_PROTECT_TEXT` message was
   sent. Then resolve the pending response (as `changed: false`) and let the
   flow finish.
4. **Enter key in editor triggers the flow**: focus the textarea, dispatch
   `new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })`
   on it, protect response `changed: false` → assert the keydown was
   `defaultPrevented` and a form `submit` event was fired (attach a submit
   listener that calls `preventDefault()` and records — jsdom supports
   `requestSubmit`, see `tests/dom-adapter.test.ts:36-49` for the pattern).

**Verify**: `npx vitest run tests/content-flow.test.ts` → 9 tests pass.

### Step 5: Characterize today's retry behavior (will change in plan 003)

Add a `describe("error-modal retry (current behavior — see plans/003)")` block:

- Protect fails → error modal → click `[data-action='retry']` with the next
  protect response set to `{ ok: true, changed: true, safeText: "safe" }`.
- Assert **current** behavior: the textarea receives `"safe"` and a replay
  click occurs **without a second review modal appearing**.
- Add the comment: `// Plan 003 intentionally changes this: retry success must re-show the review modal.`

**Verify**: `npx vitest run tests/content-flow.test.ts` → 10 tests pass.

### Step 6: Full suite + typecheck

**Verify**: `npm test` → all files pass (12 existing + 1 new).
**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0.

## Test plan

This plan IS the test plan; the cases are enumerated in steps 2–5. Model the
fake-timer handling on `tests/review-modal.test.ts` and the jsdom form/submit
handling on `tests/dom-adapter.test.ts`.

## Done criteria

- [ ] `npx tsc -p tsconfig.json --noEmit` exits 0
- [ ] `npm test` exits 0; `tests/content-flow.test.ts` exists with ≥10 passing tests
- [ ] `git status` shows only `tests/content-flow.test.ts`, `tests/helpers/chrome-stub.ts`, and `plans/README.md` changed/added
- [ ] No file under `src/` modified (`git diff --name-only -- src/` is empty)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `src/content.ts` no longer matches the excerpts above (drift).
- Importing `src/content.ts` in jsdom fails for a reason other than a missing
  `chrome` global (e.g. `crypto.subtle` or `crypto.randomUUID` unavailable in
  your Node version — the suite needs Node ≥ 20).
- jsdom's contenteditable/`innerText` behavior blocks a test as written — do
  NOT switch the fixture to contenteditable to work around it; the textarea
  fixtures above avoid jsdom's missing `innerText`. If a textarea-based test
  still can't express a case, report which one.
- You find yourself wanting to modify `src/content.ts` to export internals.

## Maintenance notes

- Plans 002, 003, and 004 modify `src/content.ts`/`src/offscreen.ts` and will
  extend or amend this suite; the retry test in step 5 is explicitly expected
  to be rewritten by plan 003.
- The chrome stub only implements `runtime.sendMessage`. If future content-script
  code touches other `chrome.*` APIs, extend the stub, not the test file.
- Reviewer focus: assert the tests drive real DOM events end-to-end (no direct
  calls into module internals) — that's what makes them characterization tests.
