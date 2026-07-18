# Plan 002: Ignore Enter pressed during IME composition

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a6293e1..HEAD -- src/content.ts tests/content-flow.test.ts`
> Plan 001 is expected to have added `tests/content-flow.test.ts`; any OTHER
> change to `src/content.ts`'s keydown handler since `a6293e1` means you must
> re-verify the "Current state" excerpt before proceeding.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-content-flow-characterization-tests.md
- **Category**: bug
- **Planned at**: commit `a6293e1`, 2026-07-17

## Why this matters

Users typing Chinese, Japanese, or Korean via an IME press Enter to **confirm
a composition**, not to send. PromptWard's keydown interceptor treats any plain
Enter in a composer as a send: it calls `preventDefault()`, runs redaction,
and replays a submit — sending a half-typed prompt mid-composition. This makes
the extension actively harmful for CJK users on every supported site. The
standard fix is to ignore keydown events where `event.isComposing` is true (or
`keyCode === 229`, the legacy IME signal some Chromium input paths still emit).

## Current state

- `src/content.ts:37-56` — the keydown capture handler. Today:

  ```ts
  // src/content.ts:37-39
  function onKeydownCapture(event: KeyboardEvent): void {
    if (event.key !== "Enter") return;
    if (!(event.metaKey || event.ctrlKey || event.shiftKey === false)) return;
  ```

  There is no `isComposing` check anywhere in the file
  (`grep -n "isComposing" src/` returns nothing).
- Repo conventions: strict TypeScript, no lint config, capture-phase handlers
  return early with no side effects for non-matching events (see the two
  guards above — match that style, no logging for the composition early-return).
- Tests: `tests/content-flow.test.ts` (from plan 001) already has an
  "Enter key in editor triggers the flow" test to model the new test on.

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Typecheck | `npx tsc -p tsconfig.json --noEmit`  | exit 0              |
| Tests     | `npm test`                           | all pass            |
| One file  | `npx vitest run tests/content-flow.test.ts` | all pass     |

## Scope

**In scope**:
- `src/content.ts` (the `onKeydownCapture` function only)
- `tests/content-flow.test.ts` (add tests)

**Out of scope**:
- `onClickCapture` / `onSubmitCapture` — clicks and form submits cannot occur
  mid-composition; do not add checks there.
- `src/content/submit-detection.ts`, `src/content/dom-adapter.ts`.

## Git workflow

- Branch: `advisor/002-ime-composition`
- Commit style: conventional commits, e.g. `fix(content): ignore Enter during IME composition`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the composition guard

In `src/content.ts`, `onKeydownCapture`, insert as the FIRST guard (before the
`event.key` check, since `keyCode === 229` events may carry key "Process" or
"Enter" depending on the platform):

```ts
function onKeydownCapture(event: KeyboardEvent): void {
  // Enter during IME composition confirms the composition, not the send.
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key !== "Enter") return;
  ...
```

**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0.

### Step 2: Add regression tests

In `tests/content-flow.test.ts`, next to the existing Enter-key test:

1. **Enter with `isComposing` is not intercepted**: focus the textarea (with
   non-empty text and a protect response that would change it), dispatch
   `new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true })`.
   Assert `defaultPrevented === false`, no `PW_PROTECT_TEXT` message was sent,
   and no `promptward-review` modal appears.
2. **keyCode 229 is not intercepted**: same, constructed as
   `new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })`
   with `Object.defineProperty(event, "keyCode", { get: () => 229 })` (the
   `KeyboardEventInit` dictionary has no `keyCode` member — jsdom, like
   browsers, requires the property override).
3. Confirm the existing plain-Enter test still passes unmodified (it proves
   normal sends are unaffected).

**Verify**: `npx vitest run tests/content-flow.test.ts` → all pass, including 2 new tests.

### Step 3: Full suite

**Verify**: `npm test` → exit 0, all files pass.

## Test plan

Covered in step 2. Pattern: the Enter-key test added by plan 001 in
`tests/content-flow.test.ts`.

## Done criteria

- [ ] `npx tsc -p tsconfig.json --noEmit` exits 0
- [ ] `npm test` exits 0 with 2 new IME tests passing
- [ ] `grep -n "isComposing" src/content.ts` shows the guard as the first line of `onKeydownCapture`
- [ ] `git status` shows only `src/content.ts`, `tests/content-flow.test.ts`, `plans/README.md` modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- `onKeydownCapture` no longer matches the excerpt (drift — e.g. plan 004
  restructured it first).
- `tests/content-flow.test.ts` does not exist (plan 001 has not landed —
  this plan depends on its harness).
- jsdom rejects the `isComposing` init property (would indicate a very old
  jsdom; the repo pins jsdom 26, which supports it).

## Maintenance notes

- If a `compositionend`-then-Enter send bug is ever reported (some IMEs fire
  Enter immediately after `compositionend` with `isComposing` already false),
  that is a distinct follow-up — deliberately out of scope here.
- Reviewer focus: the guard must precede the `event.key !== "Enter"` check,
  and must not log (hot path, fires on every keystroke).
