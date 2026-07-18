# Plan 011: Take debug logging off the send critical path and serialize log appends

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a6293e1..HEAD -- src/content.ts src/background.ts tests/`
> Plans 001–004 are expected to have modified `src/content.ts` and its tests.
> The specific excerpts to re-verify are the `await logDebug(` call sites in
> the protect flow and `appendDebugEvent` in `src/background.ts`.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW — worst case is reordered/lost *diagnostic* events, never
  user data.
- **Depends on**: plans/001-content-flow-characterization-tests.md
  (regression cover); execute after 002–004 to avoid merge friction in
  `src/content.ts`.
- **Category**: perf
- **Planned at**: commit `a6293e1`, 2026-07-17

## Why this matters

Every send is delayed by diagnostics. The protect flow in `src/content.ts`
`await`s `logDebug` five-plus times before and around the model call; each
call is a `chrome.runtime.sendMessage` round trip to the background worker,
which then does a `storage.session` read + write per event
(`appendDebugEvent`). That is serialized latency added to every single send —
for bookkeeping the user never sees. Separately, `appendDebugEvent` is a
read-modify-write with no serialization: concurrent events (two tabs, or the
burst a single send produces across content/background/offscreen/worker
contexts) interleave reads and overwrite each other, losing events — the
exact tool you need when debugging a race is itself racy.

Fix both: fire-and-forget logging in the content flow (ordering preserved via
the existing `ts` timestamp), and a promise-chain queue in the background so
appends serialize.

## Current state

- `src/content.ts` — the protect flow awaits logging at (line numbers from
  commit `a6293e1`; plans 002–004 may have shifted them — match by stage
  string): `"editor-read"` (:132), `"protect-request"` (:144),
  `"protect-response"` (:151), `"editor-set"` (:190),
  `"review-send-original"` (:215), `"review-cancelled"` (:224), plus
  `"empty-editor-ignored"` (:117) and `"editor-missed"` (:90). `logDebug`
  itself (:294-305) awaits a `getDebugSettings` round trip (cached after the
  first call) and the `PW_DEBUG_LOG` send.
- `src/background.ts:173-178`:

  ```ts
  async function appendDebugEvent(event: DebugEvent): Promise<void> {
    const events = await loadDebugLogs();
    const next = [...events, event].slice(-DEBUG_LOG_LIMIT);
    await chrome.storage.session.set({ [DEBUG_LOGS_KEY]: next });
    console.debug("[PromptWard]", event);
  }
  ```

  Callers: the `debugLog` message branch and several inline
  `appendDebugEvent(normalizeDebugEvent(...))` calls in the `protectText`
  branch (`src/background.ts:96-152`) — those inline awaits are ALSO on the
  protect critical path and are covered by the queue change (the queue makes
  the await cheap: it only enqueues... note: keep awaiting them in
  background; see step 2 rationale).
- One ordering caveat: in `protectAndMaybeSubmit`, the debug events carry a
  `ts` from `normalizeDebugEvent` **assigned in the background at append
  time** — with fire-and-forget, same-millisecond events may store out of
  order. Acceptable for diagnostics; the sidepanel shows arrival order
  (`src/sidepanel.ts:248-268` `debugRows`).
- Tests: `tests/content-flow.test.ts` (plans 001–004) drives the full flow
  and will catch any behavioral breakage; `tests/debug.test.ts` covers
  `normalizeDebugEvent`.

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Typecheck | `npx tsc -p tsconfig.json --noEmit`  | exit 0              |
| Tests     | `npm test`                           | all pass            |

## Scope

**In scope**:
- `src/content.ts` — logging call sites in the protect flow only
- `src/background.ts` — `appendDebugEvent` serialization
- `tests/content-flow.test.ts` — only if an existing test awaited log
  ordering (unlikely; adjust minimally)

**Out of scope**:
- `src/offscreen.ts` / `src/rampart-worker.ts` logging — already
  fire-and-forget (`void logDebug(...)` / sync `postMessage`).
- The debug-event schema, `DEBUG_LOG_LIMIT`, sidepanel rendering.
- Removing any log stage — every existing stage string must survive.

## Git workflow

- Branch: `advisor/011-log-latency`
- Commit style: `perf(content): fire-and-forget debug logging on the send path` /
  `fix(background): serialize debug log appends`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Fire-and-forget in the content flow

In `src/content.ts`, inside `protectAndMaybeSubmit` (and
`handleProtectResponse` if plan 003 extracted it), change `await logDebug({...})`
to `void logDebug({...})` at every stage EXCEPT leave untouched any call
whose result the code depends on (none do — verify by reading each site).
Keep the `await`-free style consistent with the existing `void logDebug(...)`
calls in the event handlers (`onClickCapture` etc.).

Two sites need care:
- `"editor-read"` and `"protect-request"` both call `await textSummary(original)`
  (a SHA-256 digest) — the summary computation itself can stay awaited or be
  moved inside the voided promise chain; simplest correct form:

  ```ts
  void (async () => {
    const originalSummary = await textSummary(original);
    void logDebug({ ...stage "editor-read"..., metadata: { ...originalSummary } });
    void logDebug({ debugId, stage: "protect-request", level: "debug", metadata: originalSummary });
  })().catch(() => undefined);
  ```

- `"editor-set"` similarly wraps a `textSummary(readback)` — same pattern.

Do NOT change the `logDebug` implementation itself.

**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0 (the
`noUnusedLocals` strict config will surface any summary variable you orphaned).
**Verify**: `npx vitest run tests/content-flow.test.ts` → all pass. If a test
asserted on `stub.sentMessages` counts that included debug messages
synchronously, adapt it with `vi.waitFor`.

### Step 2: Serialize appends in the background

In `src/background.ts`, wrap `appendDebugEvent` in a module-level chain:

```ts
let appendQueue: Promise<void> = Promise.resolve();

function appendDebugEvent(event: DebugEvent): Promise<void> {
  const task = appendQueue.then(async () => {
    const events = await loadDebugLogs();
    const next = [...events, event].slice(-DEBUG_LOG_LIMIT);
    await chrome.storage.session.set({ [DEBUG_LOGS_KEY]: next });
    console.debug("[PromptWard]", event);
  });
  appendQueue = task.catch(() => undefined); // one failure must not wedge the queue
  return task;
}
```

Keep the existing `await appendDebugEvent(...)` call sites in
`background.ts` as-is: within one message they're sequential anyway, and the
queue now makes cross-message interleaving safe. (The latency these awaits
add is one storage round trip each in the service worker, not a content-page
send stall — reducing them further is not worth the reordering risk.)

**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0.

### Step 3: Full suite

**Verify**: `npm test` → exit 0.

## Test plan

Regression cover is `tests/content-flow.test.ts` (flow behavior unchanged)
plus `tests/background-offscreen.test.ts` if plan 005 landed. Optional: if
that background harness exists, add one test — dispatch two `PW_DEBUG_LOG`
messages whose stubbed `storage.session.get` resolves on a manual trigger,
release both, assert the final `set` call contains BOTH events (the queue
prevents the lost-update). Skip if the harness doesn't exist; do not build
one for this.

## Done criteria

- [ ] `npx tsc -p tsconfig.json --noEmit` exits 0
- [ ] `npm test` exits 0
- [ ] `grep -n "await logDebug" src/content.ts` → no matches inside the protect/decision flow (matches in `handleFailure`'s modal path are acceptable if any remain by design — but prefer zero)
- [ ] `appendQueue` chain present in `src/background.ts` with the `.catch` link
- [ ] Every stage string that existed before still exists (`grep -c "stage:" src/content.ts` unchanged or higher)
- [ ] `git status` shows only in-scope files + `plans/README.md`
- [ ] `plans/README.md` status row updated

## STOP conditions

- The logging call sites have been restructured beyond recognition by plans
  002–004 drift — re-derive the sites by grepping `await logDebug` and apply
  the same transformation, but STOP if any site's return value is actually
  used.
- A content-flow test becomes flaky after the change (fire-and-forget logs
  racing test teardown) — fix by draining with `vi.waitFor` on the stub, not
  by re-awaiting in production code; if that fails twice, stop and report.

## Maintenance notes

- Debug events from one send may now interleave slightly across contexts in
  the Diagnostics panel; the shared `debugId` (UUID per send) is the join key
  — this is why every stage logs it. If ordering ever matters, sort by `ts`
  in `debugRows`, don't re-serialize the hot path.
- Reviewer focus: no log stage removed, and the queue's failure isolation
  (`.catch` on the chain link, while the returned `task` still rejects to its
  caller).
