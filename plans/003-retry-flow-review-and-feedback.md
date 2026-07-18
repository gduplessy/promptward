# Plan 003: Make the error-modal Retry path honor the review contract

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a6293e1..HEAD -- src/content.ts tests/content-flow.test.ts`
> Plans 001 (new test file) and 002 (IME guard in `onKeydownCapture`) are
> expected predecessors. Any OTHER drift in `protectAndMaybeSubmit` /
> `handleFailure` versus the excerpts below is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-content-flow-characterization-tests.md
- **Category**: bug
- **Planned at**: commit `a6293e1`, 2026-07-17

## Why this matters

PromptWard's product contract (README: "Censor by default, **never silent**")
is that redacted text is only sent after the user sees a review modal. The
error-modal Retry path breaks this twice:

1. If the retry redaction **succeeds with changes**, the code applies the
   redacted text and replays the send immediately — no review modal. The user
   clicked "Retry", not "Send"; their prompt leaves without review.
2. If the retry **fails again**, the function returns silently: the modal is
   gone, the send was already blocked, and the user gets no feedback at all —
   a dead end that looks like the site is broken.

The fix routes the retry result through the exact same decision flow as a
first-time protect result, by extracting that flow into one shared function.

## Current state

- `src/content.ts:150-233` — the main flow. After `protectText` returns, the
  handling of the response (unchanged→replay, changed→modal→confirm/original/
  cancel, fail-closed guard) occupies lines 164–230 inside
  `protectAndMaybeSubmit`.
- `src/content.ts:252-271` — the buggy path:

  ```ts
  // src/content.ts:252-271
  async function handleFailure(error: string, original: string, trigger: HTMLElement, editor: EditorHandle, debugId: string): Promise<void> {
    const decision = await showReviewModal({ original, error });
    if (decision === "retry") {
      const response = await protectText(original, debugId);
      if (response.ok && !response.changed) {
        replay(trigger, debugId);
      } else if (response.ok) {
        const applied = await editor.setText(response.safeText);
        if (!applied) { /* ...error modal... */ return; }
        replay(trigger, debugId);          // <-- sends redacted WITHOUT review
      }
      // <-- !response.ok falls through silently: no modal, no send, no feedback
    }
  }
  ```

- `src/content/review-modal.ts` — `showReviewModal` returns
  `"confirm" | "cancel" | "retry" | "original"`. Error variant shows
  Cancel + Retry; review variant shows Cancel + Send original + Send redacted
  with a 5s auto-confirm.
- Tests: `tests/content-flow.test.ts` (plan 001) contains a `describe` block
  `"error-modal retry (current behavior — see plans/003)"` that asserts the
  buggy behavior and is explicitly meant to be rewritten by this plan.
- Convention: heavy structured debug logging via `logDebug` at each stage
  (see the existing stages `"review-send-original"`, `"review-cancelled"`).
  Preserve existing log stages when moving code; do not invent a new logging
  style.

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Typecheck | `npx tsc -p tsconfig.json --noEmit`  | exit 0              |
| Tests     | `npm test`                           | all pass            |
| One file  | `npx vitest run tests/content-flow.test.ts` | all pass     |

## Scope

**In scope**:
- `src/content.ts` (`protectAndMaybeSubmit`, `handleFailure`, one new
  extracted function)
- `tests/content-flow.test.ts` (rewrite the step-5 retry block; add cases)

**Out of scope**:
- `src/content/review-modal.ts` — no new modal variants; the existing error
  and review variants suffice.
- Retry-count limits / backoff — a second consecutive failure re-shows the
  error modal, and the user can Cancel; that is acceptable UX and infinite
  auto-loops are impossible because each cycle requires a user click.

## Git workflow

- Branch: `advisor/003-retry-review-contract`
- Commit style: `fix(content): route retry results through the review modal`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Extract the response-decision flow

In `src/content.ts`, extract lines 164–230 (everything from the `if
(!response.ok)` check through the cancel branch, inclusive) into:

```ts
async function handleProtectResponse(
  response: ProtectTextResponse,
  original: string,
  trigger: HTMLElement,
  editor: EditorHandle,
  debugId: string
): Promise<void>
```

`protectAndMaybeSubmit` then becomes: read editor → guards → `protectText` →
log → `await handleProtectResponse(...)`, keeping the `inFlight` try/finally
where it is. The extracted function's `!response.ok` branch calls
`handleFailure(...)` exactly as today. Behavior after this step must be
**identical** — this is a pure extraction.

**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0.
**Verify**: `npx vitest run tests/content-flow.test.ts` → all pass unchanged
(including the old-behavior retry test — it still passes because behavior
hasn't changed yet).

### Step 2: Route retry through the shared flow

Rewrite `handleFailure` to:

```ts
async function handleFailure(error: string, original: string, trigger: HTMLElement, editor: EditorHandle, debugId: string): Promise<void> {
  const decision = await showReviewModal({ original, error });
  if (decision !== "retry") return;
  const response = await protectText(original, debugId);
  await logDebug({
    debugId,
    stage: "retry-protect-response",
    level: response.ok ? "debug" : "error",
    metadata: { ok: response.ok, changed: response.ok ? response.changed : undefined, error: response.error }
  });
  await handleProtectResponse(response, original, trigger, editor, debugId);
}
```

Consequences (all intended): retry success with changes now shows the review
modal; retry failure now recursively shows the error modal again (bounded by
requiring a user click per cycle); retry success unchanged still replays
directly.

**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0. The old-behavior
retry test in `tests/content-flow.test.ts` now FAILS — expected; fixed next.

### Step 3: Rewrite the retry tests

Replace the `"error-modal retry (current behavior — see plans/003)"` block
with `"error-modal retry"` covering:

1. **Retry success with changes shows the review modal**: fail → modal →
   click Retry with next response `{ ok: true, changed: true, safeText: "safe" }`
   → assert a review modal (has `[data-action='original']`) appears and NO
   replay click has happened yet → auto-confirm → textarea is `"safe"`, replay
   click observed.
2. **Retry failure re-shows the error modal**: fail → Retry with next response
   also failing → assert a new error modal appears (no
   `[data-action='original']`) → click Cancel → no replay ever, textarea
   unchanged.
3. **Retry success unchanged replays without a modal** (unchanged behavior):
   fail → Retry with `{ ok: true, changed: false, safeText: original }` →
   replay click observed, no second modal.

**Verify**: `npx vitest run tests/content-flow.test.ts` → all pass.

### Step 4: Full suite

**Verify**: `npm test` → exit 0.

## Test plan

Step 3 is the test plan; model on the existing modal-interaction tests in
`tests/content-flow.test.ts` (shadow-root query + fake timers).

## Done criteria

- [ ] `npx tsc -p tsconfig.json --noEmit` exits 0
- [ ] `npm test` exits 0; the 3 retry tests above exist and pass
- [ ] In `src/content.ts`, `handleFailure` contains no direct `replay(` or `editor.setText(` call (`grep -n "replay\|setText" src/content.ts` shows them only in `handleProtectResponse`/`protectAndMaybeSubmit` helpers)
- [ ] `git status` shows only `src/content.ts`, `tests/content-flow.test.ts`, `plans/README.md` modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- `handleFailure` no longer matches the excerpt (drift).
- `tests/content-flow.test.ts` does not exist (plan 001 not landed).
- The extraction in step 1 cannot be made behavior-identical without touching
  `review-modal.ts` (out of scope — report why).

## Maintenance notes

- `handleProtectResponse` is now the single choke point between a protect
  result and anything being sent. Plan 004 (timeouts) produces `ok: false`
  responses that flow through it — keep it the only path.
- Reviewer focus: step 1 must be a pure move (diff should read as relocation);
  the behavioral change is confined to step 2's ~10 lines.
