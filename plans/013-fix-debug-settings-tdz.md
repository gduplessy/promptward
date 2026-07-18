# Plan 013: Fix the debugSettingsPromise temporal-dead-zone crash on content-script init

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a6293e1..HEAD -- src/content.ts`
> Plans 001 and 002 are expected predecessors (001 added no `src/content.ts`
> changes; 002 added a 2-line composition guard inside `onKeydownCapture` at
> the top of the file). If `debugSettingsPromise`, `getDebugSettings`, or the
> module-init block have moved beyond what's shown below, re-verify the
> "Current state" excerpt before proceeding — the exact line numbers below
> assume plans 001+002 are merged but 003/004 are not yet.

## Status

- **Priority**: P1 (blocks plan 006 — see Why this matters)
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-content-flow-characterization-tests.md,
  plans/002-ime-composition-enter.md (execute after both; execute before
  plans/003 and plans/004 if possible — see Maintenance notes — but at
  minimum before plans/006-ci-workflow.md)
- **Category**: bug
- **Planned at**: commit (plans 001+002 merged), 2026-07-17

## Why this matters

`src/content.ts` throws an unhandled `ReferenceError: Cannot access
'debugSettingsPromise' before initialization` on **every single import** of
the module — i.e. on every real page load on every supported site, and in
every test file that imports `src/content.ts`. This was discovered during
plan 001's execution and independently reproduced during plan 002's review:
`npm test` exits with code 1 even though every individual test passes,
because Vitest counts the unhandled rejection as an error and reflects it in
the process exit code. This is a genuine temporal-dead-zone (TDZ) bug, not a
test-environment artifact — confirmed with a bare `await
import("../src/content")` and nothing else in a minimal repro. It is
currently masked because the error is caught nowhere and simply logged as an
unhandled rejection rather than crashing the content script (module
evaluation of the rest of the file completes fine since the throwing call is
wrapped in `void logDebug(...)`, not awaited at the top level) — but it means
the very first debug-settings lookup silently fails and falls back to
`{ rawDiagnosticsEnabled: false }` on every page load, and it currently
**blocks plan 006 (CI)**: a CI job that runs `npm test` would report every
green test run as a failed job because of the exit code.

## Current state

- `src/content.ts:8-19` (module top level, after plans 001+002 — 001 added no
  changes here, 002 only touched `onKeydownCapture` further down):

  ```ts
  // src/content.ts:8-19
  const replaying = new WeakSet<HTMLElement>();
  const inFlight = new WeakSet<HTMLElement>();

  document.addEventListener("click", onClickCapture, true);
  document.addEventListener("keydown", onKeydownCapture, true);
  document.addEventListener("submit", onSubmitCapture, true);
  void logDebug({
    debugId: "content-init",
    stage: "listeners-installed",
    level: "info",
    metadata: { version: APP_VERSION, href: location.href }
  });
  ```

- `src/content.ts:296-317` (near the bottom of the file):

  ```ts
  // src/content.ts:296-317
  async function logDebug(input: Omit<DebugLogInput, "context" | "url" | "version">): Promise<void> {
    const settings = await getDebugSettings();
    ...
  }

  let debugSettingsPromise: Promise<DebugSettings> | undefined;

  async function getDebugSettings(): Promise<DebugSettings> {
    debugSettingsPromise ??= chrome.runtime
      .sendMessage({ type: MESSAGE_TYPES.getDebugSettings })
      .then((settings: DebugSettingsResponse) => settings)
      .catch(() => ({ rawDiagnosticsEnabled: false }));
    return debugSettingsPromise;
  }
  ```

- The mechanism: `function` declarations (`logDebug`, `getDebugSettings`) are
  fully hoisted to the top of module scope, so they're callable from line 14.
  `let debugSettingsPromise` (line 309) is hoisted as a *binding* but stays in
  the temporal dead zone until its declaration statement actually executes
  during top-to-bottom module evaluation. Calling `logDebug(...)` at line 14
  synchronously calls `getDebugSettings()` (an async function body runs
  synchronously up to its first `await`; `getDebugSettings` has no `await`
  before the `debugSettingsPromise` read, so it's fully synchronous) — this
  happens *before* the module evaluator ever reaches line 309, so the read
  throws.
- Fix: move the `let debugSettingsPromise: Promise<DebugSettings> | undefined;`
  declaration above the module-init block (next to the `replaying`/`inFlight`
  declarations at the top of the file), so it's initialized before anything
  can read it. This is a pure reordering — no logic changes.
- Repro command (for your own verification before/after the fix), from repo
  root: `npx vitest run -t "nonexistent" tests/content-flow.test.ts 2>&1 | grep -i "ReferenceError\|debugSettingsPromise"` —
  before the fix this still prints the ReferenceError (it fires on import,
  independent of which test runs); after the fix it prints nothing.

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Typecheck | `npx tsc -p tsconfig.json --noEmit`  | exit 0              |
| Tests     | `npm test`                           | exit 0 (no "Errors" line, no unhandled rejection) |
| One file  | `npx vitest run tests/content-flow.test.ts` | exit 0, no errors section |

## Scope

**In scope**:
- `src/content.ts` (move one declaration; no other changes)

**Out of scope**:
- `getDebugSettings`'s caching behavior, error handling, or the
  `debugSettingsPromise ??=` pattern itself — only its *position* is the bug.
- Any other file.

## Git workflow

- Branch: `advisor/013-debug-settings-tdz`
- Commit style: `fix(content): declare debugSettingsPromise before module-init log call`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Move the declaration

In `src/content.ts`:

1. Delete the line `let debugSettingsPromise: Promise<DebugSettings> | undefined;`
   from its current position (directly above `getDebugSettings`, near the
   bottom of the file).
2. Add it near the top of the file, directly after the existing
   `const replaying = new WeakSet<HTMLElement>();` /
   `const inFlight = new WeakSet<HTMLElement>();` pair (i.e. before the
   `document.addEventListener(...)` calls and the module-init `void
   logDebug(...)` call). Result:

   ```ts
   const replaying = new WeakSet<HTMLElement>();
   const inFlight = new WeakSet<HTMLElement>();
   let debugSettingsPromise: Promise<DebugSettings> | undefined;

   document.addEventListener("click", onClickCapture, true);
   ...
   ```

3. `getDebugSettings`'s body is unchanged — it still reads/writes the
   module-scope `debugSettingsPromise` binding, just declared earlier now.

Do not change `var`/`let`/`const`, do not add a default value, do not wrap in
a function — this is purely relocating one declaration statement so it
executes before the first possible read.

**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0.

### Step 2: Confirm the crash is gone

**Verify**: `npx vitest run tests/content-flow.test.ts 2>&1 | grep -i "ReferenceError\|debugSettingsPromise before initialization"` →
no output (previously printed the ReferenceError).
**Verify**: `npx vitest run tests/content-flow.test.ts` → exit code `$?` is `0`
(check explicitly: `npx vitest run tests/content-flow.test.ts; echo "exit: $?"` → `exit: 0`).

### Step 3: Full suite

**Verify**: `npm test; echo "exit: $?"` → `exit: 0`, and the output contains
NO `Errors` summary line (compare against before the fix, which printed
`Errors   1 error`).

## Test plan

No new test file — this is a crash fix in module-init ordering, and plan
001's existing `tests/content-flow.test.ts` already imports `src/content.ts`
at the top of the file (`beforeAll`), so its mere presence is the regression
test: if the TDZ bug ever comes back, that import throws again and the exit
code goes non-zero. Do not add a redundant standalone test for this.

## Done criteria

- [ ] `npx tsc -p tsconfig.json --noEmit` exits 0
- [ ] `npm test` exits 0 (not just "tests pass" — the literal process exit code)
- [ ] `npm test` output contains no `Errors` summary line
- [ ] `grep -n "let debugSettingsPromise" src/content.ts` shows it declared before line 11 (the first `document.addEventListener` call) — check with `grep -n "let debugSettingsPromise\|document.addEventListener(\"click\"" src/content.ts` and confirm the `let` line number is smaller
- [ ] `git status` shows only `src/content.ts` + `plans/README.md` modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The excerpts don't match current `src/content.ts` (drift from plans 003/004
  landing first, or further edits).
- Moving the declaration does NOT eliminate the ReferenceError (would mean
  the root cause is different from diagnosed here — do not guess further
  fixes, report what you observed).
- `npm test`'s exit code is 0 even before your fix (would mean the bug was
  already fixed or masked differently — verify with
  `git stash && npm test; echo $?; git stash pop` before concluding this).

## Maintenance notes

- This is exactly the class of bug plan 011 (debug logging off the critical
  path) will restructure code around — if plan 011 runs before this one, its
  executor should hit this same crash while testing and may fix it
  incidentally; if so, this plan becomes a no-op and should be marked
  REJECTED ("fixed by plan 011") rather than re-applied.
- If any future refactor reintroduces a synchronous read of a `let`-declared
  module value from code that runs at module top level (e.g. the
  `void logDebug(...)` pattern is reused elsewhere), the same class of bug
  can recur — prefer declaring stateful `let` bindings before any top-level
  side-effecting calls in this file, not interspersed with function
  definitions.
- Reviewer focus: confirm via the literal process exit code, not just "tests
  pass" — that's exactly the distinction that let this bug hide through
  plans 001 and 002's review.
