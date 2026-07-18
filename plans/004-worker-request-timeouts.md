# Plan 004: Add timeouts to worker and protect requests so a hang never silently blocks sends

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a6293e1..HEAD -- src/offscreen.ts src/content.ts tests/`
> Plans 001–003 are expected predecessors (new test file; refactored
> `handleProtectResponse` in `src/content.ts`). Any drift in `postWorker`
> versus the excerpt below is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED — a too-short timeout would break slow cold starts on weak
  hardware; limits below are deliberately generous.
- **Depends on**: plans/001-content-flow-characterization-tests.md,
  plans/003-retry-flow-review-and-feedback.md
- **Category**: bug
- **Planned at**: commit `a6293e1`, 2026-07-17

## Why this matters

When the user hits send, the content script `preventDefault()`s the real send
and awaits a `PW_PROTECT_TEXT` round trip (content → background → offscreen
document → Web Worker running the ONNX model). Two links in that chain can
hang forever:

1. `src/offscreen.ts` stores a resolver in a `pending` map and waits for the
   worker to post back. If the worker stalls (model load wedged, OOM without
   an `error` event), the promise never settles.
2. The content script awaits `chrome.runtime.sendMessage` with no timeout. If
   the offscreen document or service worker dies mid-request, Chrome may
   resolve with `undefined` — which the code then dereferences (`response.ok`)
   — or the caller may simply never get a usable answer.

Either way the user's message silently never sends and nothing tells them why.
Version 0.9.1 ("Fix side panel hanging on model load") shows this failure
class is real. Fail-closed is correct — but it must fail closed **with
feedback**, i.e. the existing error modal.

## Current state

- `src/offscreen.ts:43-44` — `let worker: Worker | undefined;` and
  `const pending = new Map<string, (response: WorkerResponse) => void>();`
- `src/offscreen.ts:135-151` — the unbounded wait:

  ```ts
  // src/offscreen.ts:135-151
  function postWorker(request: WorkerRequest): Promise<WorkerResponse> {
    return new Promise((resolve) => {
      void logDebug({ ... });
      pending.set(request.id, resolve);
      getWorker().postMessage(request);
    });
  }
  ```

  The worker `error` listener (lines 121–127) already resolves all pending
  entries with `{ ok: false, error: "Rampart worker failed", ... }` and clears
  the map — mirror that response shape for timeouts.
- `src/content.ts:273-281` — `protectText` returns
  `chrome.runtime.sendMessage(...)` directly, typed `Promise<ProtectTextResponse>`;
  a `undefined` resolution would crash at `response.ok`
  (`src/content.ts:154` and inside `handleProtectResponse` after plan 003).
- Model load cost: the ONNX model is 14.7 MB loaded from the extension bundle;
  observed cold start locally is seconds, but low-end hardware can take much
  longer. The first `protect` request triggers the cold start
  (`src/rampart-worker.ts:212-220` `getGuard` → `prewarm`).
- Error UX: an `ok: false` protect response already flows into
  `handleFailure` → error modal with Retry (post-plan-003:
  `handleProtectResponse` → `handleFailure`). No new UI is needed — timeouts
  just need to produce `ok: false` with a clear message.
- Tests: `tests/content-flow.test.ts` (plan 001 harness with the chrome stub);
  `tests/offscreen-routing.test.ts` shows the convention for testing shared
  logic without the chrome global.

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Typecheck | `npx tsc -p tsconfig.json --noEmit`  | exit 0              |
| Tests     | `npm test`                           | all pass            |

## Scope

**In scope**:
- `src/offscreen.ts` (`postWorker`)
- `src/content.ts` (`protectText`)
- `src/shared/timeout.ts` (create — small helper so both sides share one
  implementation)
- `tests/timeout.test.ts` (create), `tests/content-flow.test.ts` (add cases)

**Out of scope**:
- `src/rampart-worker.ts` — do not add internal watchdogs to the worker.
- `src/background.ts` — it just forwards; bounding both ends suffices.
- Retry/backoff logic — the error modal's Retry button already covers it.

## Git workflow

- Branch: `advisor/004-request-timeouts`
- Commit style: `fix(offscreen): time out stalled worker requests` /
  `fix(content): bound protect round trip and reject undefined responses`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create the shared timeout helper

Create `src/shared/timeout.ts`:

```ts
/** Resolves with `fallback()` if `promise` hasn't settled within `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => resolve(fallback()), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); }
    );
  });
}
```

Add `tests/timeout.test.ts` (pattern: `tests/model-progress.test.ts` for a
plain-unit file) with fake timers: resolves before deadline → value; after
deadline → fallback value; rejection propagates; timer cleared on settle.

**Verify**: `npx vitest run tests/timeout.test.ts` → 3+ tests pass.

### Step 2: Bound worker requests in the offscreen document

In `src/offscreen.ts`, add per-type limits and apply them in `postWorker`:

```ts
const WORKER_TIMEOUT_MS: Record<WorkerRequest["type"], number> = {
  prewarm: 300_000,  // cold model load on slow hardware — be generous
  protect: 240_000,  // includes a possible cold start on first send
  reveal: 15_000,
  reset: 15_000
};
```

In `postWorker`, wrap the existing promise with `withTimeout`. The fallback
must also **clean up the pending entry** so a late worker reply doesn't leak:

```ts
function postWorker(request: WorkerRequest): Promise<WorkerResponse> {
  const raw = new Promise<WorkerResponse>((resolve) => {
    void logDebug({ ...existing debug call... });
    pending.set(request.id, resolve);
    getWorker().postMessage(request);
  });
  return withTimeout(raw, WORKER_TIMEOUT_MS[request.type], () => {
    pending.delete(request.id);
    void logDebug({
      debugId: "debugId" in request && request.debugId ? request.debugId : request.id,
      context: "offscreen",
      stage: "worker-timeout",
      level: "error",
      metadata: { requestType: request.type, timeoutMs: WORKER_TIMEOUT_MS[request.type] }
    });
    return { id: request.id, ok: false, error: "PromptWard's local model did not respond in time.", status: "error" };
  });
}
```

**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0.

### Step 3: Bound the content-side round trip and reject undefined

In `src/content.ts`, rewrite `protectText`:

```ts
const PROTECT_TIMEOUT_MS = 250_000; // slightly above the offscreen protect limit

async function protectText(text: string, debugId: string): Promise<ProtectTextResponse> {
  const request = chrome.runtime
    .sendMessage({ type: MESSAGE_TYPES.protectText, text, conversationKey: getConversationKey({ url: location.href }), url: location.href, debugId })
    .then((response: ProtectTextResponse | undefined) =>
      response ?? failedResponse("PromptWard's background service did not respond.")
    )
    .catch((error: unknown) => failedResponse(formatError(error)));
  return withTimeout(request, PROTECT_TIMEOUT_MS, () =>
    failedResponse("PromptWard timed out while redacting. Nothing was sent.")
  );
}

function failedResponse(error: string): ProtectTextResponse {
  return { ok: false, safeText: "", changed: false, placeholders: [], durationMs: 0, error };
}
```

The content timeout is intentionally longer than the offscreen one so the
offscreen's more specific error normally wins; the content limit only fires
when the message channel itself is dead.

**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0.

### Step 4: Add flow tests

In `tests/content-flow.test.ts`:

1. **Undefined response fails closed with feedback**: make the chrome stub
   resolve `PW_PROTECT_TEXT` with `undefined` → dispatch send → assert the
   error modal appears (no `[data-action='original']`), no replay click.
2. **sendMessage rejection fails closed with feedback**: stub rejects with
   `new Error("Extension context invalidated")` → error modal appears, no
   replay, and no unhandled rejection (vitest would fail the test on one).

Do not attempt to test the 250s content timeout end-to-end with fake timers
through the full flow unless it is straightforward in your harness — the
`withTimeout` unit tests plus these two channel-failure tests cover the risk.

**Verify**: `npx vitest run tests/content-flow.test.ts` → all pass, 2 new.

### Step 5: Full suite

**Verify**: `npm test` → exit 0.

## Test plan

Steps 1 and 4. Unit-test the helper exhaustively with fake timers; test the
channel-failure behavior through the real flow harness.

## Done criteria

- [ ] `npx tsc -p tsconfig.json --noEmit` exits 0
- [ ] `npm test` exits 0; `tests/timeout.test.ts` exists and passes; 2 new flow tests pass
- [ ] `grep -n "withTimeout" src/offscreen.ts src/content.ts` shows both call sites
- [ ] The timeout fallback in `postWorker` deletes the pending entry (code review of the diff)
- [ ] `git status` shows only in-scope files + `plans/README.md` modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- `postWorker` or `protectText` no longer match the excerpts (drift).
- Plan 003's `handleProtectResponse` does not exist in `src/content.ts` — the
  error-routing assumption of this plan depends on it.
- You find an existing timeout/AbortController convention in the repo that
  this plan contradicts (there is none at planning time).

## Maintenance notes

- If model size grows or a WebGPU backend lands (see plans/012 and the
  direction notes in `plans/README.md`), revisit `WORKER_TIMEOUT_MS.prewarm`.
- The `reveal`/`reset` limits are short because those never load the model;
  if reveal ever triggers a cold start, raise them.
- Reviewer focus: the fallback path must not leave `pending` entries behind,
  and a late worker reply after a timeout must be a no-op (the existing
  `pending.get(...) === undefined` guard in the message listener already
  handles this — confirm it survived).
