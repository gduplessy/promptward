# Plan 010: Deduplicate the worker protocol types and escapeHtml

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a6293e1..HEAD -- src/offscreen.ts src/rampart-worker.ts src/content/review-modal.ts src/sidepanel.ts`
> Plan 004 may have already touched `offscreen.ts` (timeouts) — that's fine;
> what matters is whether the duplicated `WorkerRequest` unions and
> `escapeHtml` bodies still exist in both places. If either duplication is
> already gone, skip its steps and note that in the status row.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (coordinates with 004 — see drift check)
- **Category**: tech-debt
- **Planned at**: commit `a6293e1`, 2026-07-17

## Why this matters

Two verbatim duplications invite silent drift:

1. The `WorkerRequest` union is declared identically in `src/offscreen.ts:9-22`
   and `src/rampart-worker.ts:6-19`. These are the two ends of a
   `postMessage` protocol; if one side adds a field the other doesn't know
   about, the compiler cannot catch it — exactly the failure TypeScript
   exists to prevent. (`WorkerResponse` lives only in `offscreen.ts` today;
   moving it too gives the worker's replies a checked contract.)
2. `escapeHtml` is implemented twice, byte-identical, in
   `src/content/review-modal.ts:130-145` and `src/sidepanel.ts:270-285`.
   It is the XSS boundary for prompt text rendered into `innerHTML`; a future
   "fix" applied to one copy but not the other is a security regression.

## Current state

- `src/offscreen.ts:9-22` and `src/rampart-worker.ts:6-19` — identical
  `WorkerRequest` union (`protect` / `reveal` / `prewarm` / `reset` variants).
- `src/offscreen.ts:24-36` — `WorkerResponse` union (only declared here; the
  worker constructs conforming literals untyped).
- `src/content/review-modal.ts:130-145` and `src/sidepanel.ts:270-285` —
  identical `escapeHtml(value: string): string` with a `switch` over
  `[&<>"']`.
- Shared-code convention: cross-context modules live in `src/shared/`
  (`messages.ts`, `debug.ts`, `settings.ts`, `conversation.ts`,
  `offscreen-routing.ts`, `model-progress.ts`). Both the offscreen page and
  the worker already import from `src/shared/` (`offscreen.ts` imports
  `./shared/messages`; `rampart-worker.ts` imports `./shared/messages` and
  `./shared/debug`), so bundling is proven for both contexts.
- Tests convention: one small file per shared module (`tests/messages.test.ts`,
  `tests/debug.test.ts`, ...).

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Typecheck | `npx tsc -p tsconfig.json --noEmit`  | exit 0              |
| Tests     | `npm test`                           | all pass            |
| Build     | `npm run build`                      | exit 0              |

## Scope

**In scope**:
- `src/shared/worker-protocol.ts` (create)
- `src/shared/html.ts` (create)
- `src/offscreen.ts`, `src/rampart-worker.ts` (switch to shared types)
- `src/content/review-modal.ts`, `src/sidepanel.ts` (switch to shared escapeHtml)
- `tests/html.test.ts` (create)

**Out of scope**:
- Any behavioral change: message shapes, timeout values (if plan 004 landed),
  modal markup, sidepanel markup. This is a pure move.
- `src/shared/messages.ts` — the runtime message contract is separate from
  the worker protocol; do not merge them.

## Git workflow

- Branch: `advisor/010-dedupe`
- Commit style: `refactor(shared): single source for worker protocol and escapeHtml`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Extract the worker protocol

Create `src/shared/worker-protocol.ts` containing `WorkerRequest` (moved
verbatim from `src/offscreen.ts:9-22`) and `WorkerResponse` (moved verbatim
from `src/offscreen.ts:24-36`), both exported. It may import
`PlaceholderSummary` from `./messages`.

In `src/offscreen.ts`: delete the local declarations, import both types from
`./shared/worker-protocol`.
In `src/rampart-worker.ts`: delete the local `WorkerRequest`, import it from
`./shared/worker-protocol`. Additionally, type the worker's replies: the
`self.postMessage({ id: ..., ok: true, ...response })` success path and the
error path — introduce a local `function respond(response: WorkerResponse): void { self.postMessage(response); }`
and route both through it, so the compiler checks reply shapes. Note the
success path spreads `Record<string, unknown>` from `handleRequest`; if
making that fully type-safe requires restructuring `handleRequest`'s return
types, do the minimal version: keep `handleRequest` as-is and cast at the
single `respond` call site with a comment. Do not restructure the handler.

**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0.
**Verify**: `grep -c "type: \"protect\"" src/offscreen.ts src/rampart-worker.ts` → `0` in both (the union literals now live only in `src/shared/worker-protocol.ts`).

### Step 2: Extract escapeHtml

Create `src/shared/html.ts` with the function moved verbatim (either copy —
they are identical). In `src/content/review-modal.ts` and `src/sidepanel.ts`,
delete the local copies and import from `../shared/html` /
`./shared/html` respectively.

**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0.
**Verify**: `grep -rn "function escapeHtml" src/` → exactly one match, in `src/shared/html.ts`.

### Step 3: Test the shared escapeHtml

Create `tests/html.test.ts` (pattern: `tests/debug.test.ts`):

- Escapes all five characters: input `<img src=x onerror="a&b('c')">` contains
  no `<`, `>`, `"`, `'`, or bare `&` in the output.
- Round-trip safety: output injected via `innerHTML` into a div yields
  `textContent` equal to the original input.
- Leaves plain text untouched.

**Verify**: `npx vitest run tests/html.test.ts` → all pass.

### Step 4: Full verification

**Verify**: `npm test` → exit 0 (the review-modal and sidepanel behavior is
covered by `tests/review-modal.test.ts` and, if plans 001–004 landed,
`tests/content-flow.test.ts` — all must stay green).
**Verify**: `npm run build` → exit 0 (proves the worker bundle still resolves
the shared import).

## Test plan

Step 3, plus the existing suites as regression cover. No new tests for the
type move — the compiler is the test.

## Done criteria

- [ ] `npx tsc -p tsconfig.json --noEmit` exits 0
- [ ] `npm test` and `npm run build` exit 0
- [ ] `grep -rn "function escapeHtml" src/` → 1 match (shared)
- [ ] `WorkerRequest` declared exactly once (`grep -rn "type WorkerRequest" src/` → 1 match)
- [ ] `git status` shows only in-scope files + `plans/README.md`
- [ ] `plans/README.md` status row updated

## STOP conditions

- Either duplication is already gone (someone consolidated first) — skip that
  half, note it, continue with the other.
- Typing the worker's `respond` path requires restructuring `handleRequest`
  beyond a single cast — stop and report; that's a bigger refactor than this
  plan authorizes.
- `npm run build` fails on the worker importing the new shared module —
  report the bundler error verbatim rather than working around it with a
  re-duplication.

## Maintenance notes

- Any future worker message variant is added in `src/shared/worker-protocol.ts`
  only; both ends now fail typecheck if they disagree.
- `escapeHtml` is a security boundary — its shared test file is where any
  future escaping change must add cases first.
- If plan 004 landed before this one, its `WORKER_TIMEOUT_MS` record is keyed
  by `WorkerRequest["type"]` — the import move must keep that compiling
  (it will, the type is unchanged).
