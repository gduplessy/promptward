# Plan 006: Add a CI workflow that runs the full verification suite on every push

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a6293e1..HEAD -- package.json scripts/ .github/`
> If `.github/workflows/` already exists, STOP — someone added CI first;
> reconcile instead of overwriting.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `a6293e1`, 2026-07-17

## Why this matters

The repo has a complete one-command verification story — asset checksums,
strict typecheck, a 41-test suite (including an end-to-end run of the vendored
ONNX model), and a production build — but nothing runs any of it
automatically. Every release since 0.1.0 shipped on whatever the developer
remembered to run locally. A single GitHub Actions workflow closes that gap
and becomes the verification gate every other plan in this directory cites.

## Current state

- No `.github/` directory exists.
- Verification commands (all verified working locally at planning time):
  - `npm run verify:assets` → checks `public/models/rampart/**` and
    `public/ort/**` against `public/asset-manifest.json` checksums
    (`scripts/verify-assets.mjs`). The model and ORT assets ARE committed to
    the repo (~108 MB under `public/`), so CI needs no vendoring step —
    checkout is enough.
  - `npx tsc -p tsconfig.json --noEmit` → typecheck (also part of `npm run build`).
  - `npm test` → vitest; includes `tests/rampart-local-model.test.ts` which
    loads the committed ONNX model in Node (~23 s total suite locally, 120 s
    per-test timeout already configured in the file).
  - `npm run build` → `verify:assets` + typecheck + `vite build` into `dist/`.
- `package.json` engines: none declared. Local dev uses Node 24 types
  (`@types/node@^24`); pick Node 22 (current LTS) for CI.
- Default branch: `master`.

## Commands you will need

| Purpose        | Command                             | Expected on success |
|----------------|-------------------------------------|---------------------|
| Local dry run  | `npm ci && npm run build && npm test` | exit 0            |
| YAML sanity    | `npx yaml-lint .github/workflows/ci.yml` — SKIP if the package is unavailable; a careful read suffices | exit 0 / n-a |

## Scope

**In scope**:
- `.github/workflows/ci.yml` (create)

**Out of scope**:
- Release automation / zip packaging on tags (`npm run package`) — worthwhile
  later, but keep this plan to the verification gate.
- Adding lint/format tooling — the repo has none; do not introduce any here.
- `package.json` changes.

## Git workflow

- Branch: `advisor/006-ci`
- Commit style: `ci: add build and test workflow`
- Do NOT push or open a PR unless the operator instructed it. (Note: the
  workflow can only be observed running once pushed; local verification is
  the dry run below.)

## Steps

### Step 1: Create the workflow

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [master]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run verify:assets
      - run: npx tsc -p tsconfig.json --noEmit
      - run: npm test
      - run: npm run build
```

Notes baked into this design (do not "improve" them away):
- `npm run build` re-runs `verify:assets` and `tsc`; the explicit earlier
  steps exist so a failure is attributed to the right stage in the UI.
- No artifact upload — `dist/` verification is the point, not distribution.
- The model test needs no network: `env.allowRemoteModels = false` and the
  model is loaded from the committed `public/models/` path.

**Verify**: file exists; indentation is two spaces throughout;
`git status` shows only the new file.

### Step 2: Local equivalent dry run

Run exactly what CI will run, in order:

**Verify**: `npm ci` → exit 0 (this deletes and reinstalls `node_modules` — expected).
**Verify**: `npm run verify:assets` → prints `Local model and ORT assets verified`.
**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0.
**Verify**: `npm test` → all tests pass.
**Verify**: `npm run build` → exit 0, `dist/` populated.

## Test plan

No unit tests — the workflow is itself a test harness. The dry run in step 2
is the verification.

## Done criteria

- [ ] `.github/workflows/ci.yml` exists with the five run steps above
- [ ] The full local dry-run sequence in step 2 exits 0
- [ ] `git status` shows only `.github/workflows/ci.yml` + `plans/README.md`
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- `.github/workflows/` already exists (drift — reconcile, don't overwrite).
- `npm ci` fails on a clean install (lockfile drift — report, don't fix here).
- `npm test` passes locally but you have reason to believe the model test
  needs network access in CI (it should not; if you find a remote fetch in
  `tests/rampart-local-model.test.ts`, report it).

## Maintenance notes

- When plan 007 trims `public/ort/`, this workflow's `verify:assets` step is
  what proves the trim didn't break the checksum manifest.
- Follow-up deliberately deferred: a `release.yml` that runs `npm run package`
  on tags and attaches `packages/promptward-extension.zip` to the GitHub
  Release — do it once this gate is green on `master`.
- The ~108 MB of committed model/ORT assets makes checkout the slowest step;
  if CI time matters later, consider `actions/checkout` sparse-checkout minus
  `videos/`.
