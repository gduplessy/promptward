# Plan 012: Remove the no-op WebGPU toggle from settings and the side panel

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `grep -rn "webGpuEnabled\|webgpu" src/ --include="*.ts" -i`
> Expected matches at planning time: `src/shared/messages.ts:28`,
> `src/shared/settings.ts:7`, `src/sidepanel.ts` (the toggle row and its
> change handler). If `webGpuEnabled` is READ anywhere else (e.g. the worker
> now selects a device with it), the feature was wired — STOP; this plan is
> obsolete and should be marked REJECTED.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `a6293e1`, 2026-07-17

## Why this matters

The side panel ships a "WebGPU" toggle whose label admits it does nothing
("Reserved opt-in; WASM remains the default backend"). The stored
`webGpuEnabled` setting is written by the toggle and read by **no runtime
code** — the worker hardcodes `device: "wasm"`. A visible control that has no
effect erodes trust in a privacy tool ("what else in here is fake?") and adds
a settings field every future change must carry. Remove it; if WebGPU is ever
actually wired (a real direction option — the upstream Rampart package ships
WebGPU benchmarks), the toggle returns together with the code that honors it.

## Current state

- `src/shared/messages.ts:24-29` — `PromptWardSettings` includes
  `webGpuEnabled: boolean;`
- `src/shared/settings.ts:3-8` — `DEFAULT_SETTINGS` includes
  `webGpuEnabled: false`.
- `src/sidepanel.ts:40-47` — the toggle row:

  ```html
  <label class="row"> ... <strong>WebGPU</strong>
    <small>Reserved opt-in; WASM remains the default backend.</small> ...
    <input id="webgpu" type="checkbox" ${settings.webGpuEnabled ? "checked" : ""} />
  ```

  and `src/sidepanel.ts:107-110` — its change handler writing
  `chrome.storage.sync.set({ webGpuEnabled: ... })`.
- No other reads. The worker's device selection: `src/rampart-worker.ts:175-177`
  (`device: "wasm"` hardcoded) — NOT to be touched by this plan.
- `loadSettings` (`src/shared/settings.ts:32-43`) spreads stored sync values
  over defaults; after removal, a stale `webGpuEnabled` key left in users'
  `chrome.storage.sync` is simply carried through the spread at runtime and
  ignored — harmless, no migration needed (do not write cleanup code).
- Tests referencing settings: `tests/settings.test.ts` uses
  `DEFAULT_SETTINGS` spreads — removal is transparent to it, but run it.

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Typecheck | `npx tsc -p tsconfig.json --noEmit`  | exit 0              |
| Tests     | `npm test`                           | all pass            |
| Build     | `npm run build`                      | exit 0              |

## Scope

**In scope**:
- `src/shared/messages.ts` (`PromptWardSettings` field)
- `src/shared/settings.ts` (`DEFAULT_SETTINGS` field)
- `src/sidepanel.ts` (toggle row + change handler)

**Out of scope**:
- `src/rampart-worker.ts` — do not wire WebGPU as part of this plan.
- Storage migration/cleanup of the stale key in users' sync storage.
- `sidepanel.css` — the `.row` styles are shared; nothing WebGPU-specific
  exists there (verify with `grep -in "webgpu" src/sidepanel.css` → no match).

## Git workflow

- Branch: `advisor/012-remove-webgpu-toggle`
- Commit style: `refactor(sidepanel): remove no-op WebGPU toggle`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Remove the field from the type and defaults

Delete `webGpuEnabled: boolean;` from `PromptWardSettings` in
`src/shared/messages.ts` and `webGpuEnabled: false` from `DEFAULT_SETTINGS`
in `src/shared/settings.ts`.

**Verify**: `npx tsc -p tsconfig.json --noEmit` → FAILS, pointing at exactly
the sidepanel usages (this confirms the full usage list before you touch UI
code). If it points anywhere else, that's an unlisted reader — STOP.

### Step 2: Remove the UI row and handler

In `src/sidepanel.ts`, delete the WebGPU `<label class="row">...` block from
the template and the `#webgpu` change-handler block in `bind()`.

**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0.
**Verify**: `grep -rin "webgpu" src/` → no matches.

### Step 3: Full verification

**Verify**: `npm test` → all pass.
**Verify**: `npm run build` → exit 0.

## Test plan

No new tests — the removal is proven by the typecheck sweep in step 1 and the
green suite. `tests/settings.test.ts` continues to pass unmodified.

## Done criteria

- [ ] `grep -rin "webgpu" src/` returns nothing
- [ ] `npx tsc -p tsconfig.json --noEmit`, `npm test`, `npm run build` all exit 0
- [ ] `git status` shows only the three in-scope files + `plans/README.md`
- [ ] `plans/README.md` status row updated

## STOP conditions

- The drift-check grep shows `webGpuEnabled` read outside the sidepanel
  (feature was wired) — mark REJECTED, report.
- Step 1's typecheck failure list includes files not in scope.

## Maintenance notes

- If WebGPU is wired later: reintroduce the setting, pass
  `device: settings.webGpuEnabled ? "webgpu" : "wasm"` through the prewarm
  message into `src/rampart-worker.ts`, add the `jsep` ORT files back to the
  vendor keep-list (see `plans/007-trim-ort-assets.md` maintenance notes),
  and revisit the prewarm timeout in `plans/004`. Those three couplings are
  why the dead toggle was worth removing rather than leaving "for later".
