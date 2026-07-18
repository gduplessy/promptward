# Plan 005: Serialize offscreen-document creation to fix the concurrent-create race

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a6293e1..HEAD -- src/background.ts tests/`
> Any drift in `ensureOffscreenDocument` versus the excerpt below is a STOP
> condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `a6293e1`, 2026-07-17

## Why this matters

Chrome MV3 allows exactly one offscreen document per extension. The background
service worker creates it lazily with a check-then-act:
`getContexts()` → if empty → `createDocument()`. Two messages arriving
concurrently (e.g. two tabs both send a prompt right after the service worker
wakes, or a tab-close `resetConversation` races a `protectText`) can both see
"no context" and both call `createDocument`; the second throws
`Only a single offscreen document may be created`, failing that request — for
a protect request, the user gets a spurious "Prompt blocked" error modal. The
fix is the standard promise-memoization pattern plus tolerating the
already-exists error.

## Current state

- `src/background.ts:180-198`:

  ```ts
  // src/background.ts:180-198
  async function sendToOffscreen(message: PromptWardMessage): Promise<unknown> {
    await ensureOffscreenDocument();
    return chrome.runtime.sendMessage(message);
  }

  async function ensureOffscreenDocument(): Promise<void> {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)]
    });

    if (contexts.length > 0) return;

    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: "Runs the local Rampart model worker outside the MV3 service worker lifecycle."
    });
  }
  ```

- Callers of `sendToOffscreen`: tab-removed/updated listeners
  (`src/background.ts:28-42`), the `protectText` branch, and the passthrough
  at the bottom of `handleMessage` (`src/background.ts:156`).
- No test currently imports `src/background.ts` (its top-level code registers
  five `chrome.*` listeners, so importing it requires a fuller chrome stub
  than `tests/helpers/chrome-stub.ts` provides — that stub, if plan 001 has
  landed, only implements `runtime.sendMessage`).
- Note: the MV3 service worker can be killed at any time, which resets module
  state — the memoized promise must be cleared on failure so a crashed create
  can be retried, but does NOT need cross-restart persistence (a fresh worker
  re-checks `getContexts` anyway).

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Typecheck | `npx tsc -p tsconfig.json --noEmit`  | exit 0              |
| Tests     | `npm test`                           | all pass            |
| One file  | `npx vitest run tests/background-offscreen.test.ts` | all pass |

## Scope

**In scope**:
- `src/background.ts` (`ensureOffscreenDocument` only)
- `tests/background-offscreen.test.ts` (create)
- `tests/helpers/chrome-stub.ts` (extend if it exists; create a dedicated
  background stub inside the new test file if it does not)

**Out of scope**:
- `src/offscreen.ts`, `src/content.ts` — the race is entirely background-side.
- Any change to message routing or `handleMessage` branches.

## Git workflow

- Branch: `advisor/005-offscreen-create-race`
- Commit style: `fix(background): serialize offscreen document creation`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Memoize creation and tolerate already-exists

Replace `ensureOffscreenDocument` in `src/background.ts` with:

```ts
let offscreenCreation: Promise<void> | undefined;

function ensureOffscreenDocument(): Promise<void> {
  offscreenCreation ??= createOffscreenDocumentIfMissing().catch((error: unknown) => {
    offscreenCreation = undefined; // allow retry after a real failure
    throw error;
  });
  return offscreenCreation;
}

async function createOffscreenDocumentIfMissing(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)]
  });
  if (contexts.length > 0) return;
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: "Runs the local Rampart model worker outside the MV3 service worker lifecycle."
    });
  } catch (error) {
    // A concurrent path (or a pre-existing document the getContexts snapshot
    // missed) already created it - that is success, not failure.
    if (error instanceof Error && /single offscreen document/i.test(error.message)) return;
    throw error;
  }
}
```

Important subtlety: once resolved, `offscreenCreation` stays resolved for the
worker's lifetime even if the offscreen document is later closed by Chrome.
Chrome does not close offscreen documents with `Reason.WORKERS` on idle
automatically, and the previous code had the same one-shot-per-check
semantics per call; if you want extra safety, re-run `getContexts` when
`offscreenCreation` is already settled — but ONLY if you can express it
without reintroducing the race (e.g. always route through the memoized
promise chain: `offscreenCreation = offscreenCreation.then(() =>
createOffscreenDocumentIfMissing())`). The simple chained form is the
recommended implementation:

```ts
function ensureOffscreenDocument(): Promise<void> {
  const next = (offscreenCreation ?? Promise.resolve())
    .catch(() => undefined)          // a past failure must not poison future attempts
    .then(() => createOffscreenDocumentIfMissing());
  offscreenCreation = next;
  return next;
}
```

Use the chained form — it both serializes concurrent calls and re-verifies
existence on every send, which matches the original intent.

**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0.

### Step 2: Test concurrent creation

Create `tests/background-offscreen.test.ts`. Before importing
`src/background.ts`, stub a fuller chrome global (in the test file or the
shared helper):

```ts
const listeners: { onMessage?: Function } = {};
const createDocument = vi.fn(async () => { await new Promise((r) => setTimeout(r, 10)); });
const getContexts = vi.fn(async () => []);
vi.stubGlobal("chrome", {
  runtime: {
    onInstalled: { addListener: vi.fn() },
    onStartup: { addListener: vi.fn() },
    onMessage: { addListener: vi.fn((fn: Function) => { listeners.onMessage = fn; }) },
    getContexts,
    getURL: (p: string) => `chrome-extension://test/${p}`,
    sendMessage: vi.fn(async () => ({ ok: true })),
    ContextType: { OFFSCREEN_DOCUMENT: "OFFSCREEN_DOCUMENT" }
  },
  offscreen: { createDocument, Reason: { WORKERS: "WORKERS" } },
  storage: {
    onChanged: { addListener: vi.fn() },
    sync: { get: vi.fn(async (defaults: unknown) => defaults), set: vi.fn(async () => undefined) },
    local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) },
    session: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) }
  },
  tabs: { onRemoved: { addListener: vi.fn() }, onUpdated: { addListener: vi.fn() } },
  sidePanel: { setPanelBehavior: vi.fn(async () => undefined) },
  scripting: {
    registerContentScripts: vi.fn(async () => undefined),
    unregisterContentScripts: vi.fn(async () => undefined)
  }
} as unknown as typeof chrome);
await import("../src/background");
```

Then drive the captured `listeners.onMessage` (signature:
`(message, sender, sendResponse) => boolean`) with two concurrent
`{ type: "PW_PREWARM_MODEL" }` messages (collect both `sendResponse`
callbacks into promises), and assert:

1. `createDocument` was called exactly once (`getContexts` returns `[]` both
   times, but the chained promise serializes; the second pass runs after the
   first create resolves — have `getContexts` return a non-empty array once
   `createDocument` has resolved, mirroring real Chrome).
2. Both responses arrive `ok`.
3. A third message after `createDocument` resolved does not call it again.

Also test the tolerated error: make `createDocument` reject once with
`new Error("Only a single offscreen document may be created.")` while
`getContexts` still reports empty → the message must still get an `ok`
response.

**Verify**: `npx vitest run tests/background-offscreen.test.ts` → all pass.

### Step 3: Full suite

**Verify**: `npm test` → exit 0.

## Test plan

Step 2. Pattern for stubbed-global + dynamic import:
`tests/helpers/chrome-stub.ts` from plan 001 if present; otherwise this file
is self-contained.

## Done criteria

- [ ] `npx tsc -p tsconfig.json --noEmit` exits 0
- [ ] `npm test` exits 0; new test file passes with ≥3 tests
- [ ] `src/background.ts` contains no bare check-then-act on `createDocument` outside the serialized chain
- [ ] `git status` shows only in-scope files + `plans/README.md` modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- `ensureOffscreenDocument` no longer matches the excerpt (drift).
- Importing `src/background.ts` under the stub throws for an API the stub
  list above doesn't cover — extend the stub for read-only listener
  registration only; if the module gained new top-level side effects beyond
  listener registration, report instead.
- The already-exists error message pattern differs in `@types/chrome` docs
  you can verify — do not guess alternative regexes beyond the one given.

## Maintenance notes

- If a future change adds `chrome.offscreen.closeDocument` calls (e.g. to
  free model memory), the chained `ensureOffscreenDocument` already re-checks
  existence per send, so it stays correct — but add a test for close-then-send.
- Reviewer focus: the `.catch(() => undefined)` link in the chain is what
  prevents one failed create from permanently poisoning all later sends —
  don't let review "simplify" it away.
