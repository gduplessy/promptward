# Plan 007: Vendor only the ONNX Runtime files the extension actually loads

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a6293e1..HEAD -- scripts/ src/rampart-worker.ts public/ort/`
> Any drift in `scripts/vendor-ort.mjs` or the worker's WASM configuration
> versus the excerpts below is a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED — an over-aggressive keep-list breaks model loading at
  runtime, which no automated test in this repo exercises (the Node-based
  model test uses `node_modules`, not `public/ort/`). A manual Chrome check
  is a REQUIRED gate in this plan.
- **Depends on**: plans/006-ci-workflow.md (recommended, not blocking — CI
  proves the checksum manifest stays consistent)
- **Category**: perf
- **Planned at**: commit `a6293e1`, 2026-07-17

## Why this matters

`scripts/vendor-ort.mjs` copies **every** `.wasm`/`.mjs` file from
`node_modules/onnxruntime-web/dist` into `public/ort/` — currently 93 MB
across ~25 files (webgpu, webgl, jspi, asyncify, node, and bundle variants).
The runtime configuration pins a single execution path: WASM backend,
`numThreads: 1`, `proxy: false`, `dtype: q4`, `device: "wasm"` — which loads
exactly one WASM binary family (`ort-wasm-simd-threaded.*`). The release zip
is 39 MB and the repo carries ~93 MB of dead weight in git and in every
user's unpacked extension directory. Trimming the keep-list roughly halves
the install size and shrinks CI checkout.

## Current state

- `scripts/vendor-ort.mjs:9-13` — the copy-everything loop:

  ```js
  for (const item of await fs.readdir(sourceDir)) {
    if (!/\.(wasm|mjs)$/.test(item)) continue;
    await fs.copyFile(path.join(sourceDir, item), path.join(ortDir, item));
    copied.push(item);
  }
  ```

- `src/rampart-worker.ts:60-64` — the runtime constraint:

  ```ts
  const wasm = env.backends.onnx.wasm;
  if (!wasm) throw new Error("Transformers ONNX WASM backend is unavailable");
  wasm.wasmPaths = ortBaseUrl;   // -> chrome-extension://<id>/ort/
  wasm.proxy = false;
  wasm.numThreads = 1;
  ```

  and `src/rampart-worker.ts:175-177`: `pipeline(..., { dtype: "q4", device: "wasm", ... })`.
- `public/ort/` currently contains (93 MB): `ort-wasm-simd-threaded.{wasm,mjs}`,
  `.jsep.{wasm,mjs}`, `.asyncify.{wasm,mjs}`, `.jspi.{wasm,mjs}`, plus ~17
  `ort.*.mjs` loader bundles (`ort.all.*`, `ort.webgpu.*`, `ort.node.min.mjs`, …).
- How the files are used at runtime: transformers.js (v3.7.5) bundles the ORT
  JavaScript into the Vite worker bundle at build time; `wasmPaths` is only
  used to fetch the WASM-side artifacts at runtime. With `numThreads: 1` and
  no WebGPU, ORT dynamically imports `ort-wasm-simd-threaded.mjs` and fetches
  `ort-wasm-simd-threaded.wasm` from `wasmPaths`. The `jsep` pair is the
  WebGPU/WebNN build — unused (and plan 012 removes the dormant WebGPU
  toggle). The `asyncify`/`jspi` pairs and all `ort.*.mjs` top-level bundles
  are never requested.
- Checksums: `scripts/assets.mjs` `writeChecksums()` regenerates
  `public/asset-manifest.json` from whatever is on disk; `npm run
  verify:assets` (also the first step of `npm run build`) fails on any
  mismatch, missing checksum, or missing file. Both vendor scripts call
  `writeChecksums()` at the end.
- Diagnostics: with the side panel open, model-load progress and errors
  appear in the Diagnostics list (background `console.debug` + storage-backed
  events) — a missing ORT file surfaces there as a failed fetch/import during
  "Loading model".

## Commands you will need

| Purpose        | Command                              | Expected on success |
|----------------|--------------------------------------|---------------------|
| Re-vendor      | `npm run vendor:ort`                 | prints count + regenerates manifest |
| Asset check    | `npm run verify:assets`              | `Local model and ORT assets verified` |
| Typecheck      | `npx tsc -p tsconfig.json --noEmit`  | exit 0              |
| Tests          | `npm test`                           | all pass            |
| Build          | `npm run build`                      | exit 0, `dist/` populated |
| Package        | `npm run package`                    | writes `packages/promptward-extension.zip` |
| Size check     | `du -sh public/ort dist` (Git Bash)  | see step targets    |

## Scope

**In scope**:
- `scripts/vendor-ort.mjs`
- `scripts/verify-assets.mjs` (tighten the ORT existence check to the keep-list)
- `public/ort/**` (files removed by re-running the vendor script)
- `public/asset-manifest.json` (regenerated)
- `README.md` (one line, only if it mentions ORT file counts — at planning
  time it does not, so likely no change)

**Out of scope**:
- `src/rampart-worker.ts` — do NOT change runtime configuration to match the
  trim; the trim must match the existing configuration.
- `public/models/**` — model assets are all required.
- `.gitignore`.

## Git workflow

- Branch: `advisor/007-trim-ort`
- Commit style: `perf(assets): vendor only the ORT wasm variant the runtime loads`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Introduce the keep-list in the vendor script

In `scripts/vendor-ort.mjs`, replace the extension-based filter with an
explicit keep-list:

```js
const KEEP = [
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.mjs"
];
```

Copy only `KEEP` entries; throw listing any that are missing from
`node_modules/onnxruntime-web/dist` (fail loud, not partial). Keep the
`writeChecksums()` call.

**Verify**: `node -e "console.log('syntax ok')" && node --check scripts/vendor-ort.mjs` → no error.

### Step 2: Clear and re-vendor

Delete the current contents of `public/ort/` (tracked files — use
`git rm -r --cached` semantics via plain deletion; git will stage the
removals), then run:

**Verify**: `npm run vendor:ort` → prints `Vendored 2 ONNX Runtime Web assets into ...`.
**Verify**: `ls public/ort` → exactly `ort-wasm-simd-threaded.wasm` and `ort-wasm-simd-threaded.mjs`.
**Verify**: `npm run verify:assets` → `Local model and ORT assets verified`
(the manifest was regenerated, so removed files no longer have dangling
checksums — the verify script iterates actual files, so this passes).
**Verify**: `du -sh public/ort` → ~21 MB or less (was 93 MB).

### Step 3: Tighten verify-assets

In `scripts/verify-assets.mjs`, replace the loose "at least one `.wasm` and
one `.mjs`" check (lines 11–17) with an explicit required-file check
mirroring `requiredModelFiles`: import or declare the same keep-list and fail
if any keep-list file is missing from `public/ort/`. Export the keep-list
from `scripts/assets.mjs` (alongside `requiredModelFiles`) so the two scripts
share it.

**Verify**: `npm run verify:assets` → passes. Temporarily rename
`public/ort/ort-wasm-simd-threaded.mjs`, run again → fails naming that file;
rename back, passes.

### Step 4: Build, test, package

**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0.
**Verify**: `npm test` → all pass (the Node model test does not touch `public/ort/`).
**Verify**: `npm run build` → exit 0.
**Verify**: `grep -rl "ort-wasm" dist/ | head` → the worker bundle references
`ort-wasm-simd-threaded` only; `grep -rl "jsep\|asyncify\|jspi" dist/*.js dist/assets 2>/dev/null`
finding matches is fine (dead code strings inside the bundled ORT JS), but if
you can see a **dynamic import or fetch path** for a jsep/asyncify/jspi file
that would execute under `device: "wasm"`, treat it as a STOP condition.
**Verify**: `npm run package` → zip written;
`du -h packages/promptward-extension.zip` → expected well under 20 MB (was 39 MB).

### Step 5: REQUIRED manual runtime gate

This step needs a human or a browser-capable agent; if you cannot perform it,
mark the plan `BLOCKED (needs manual Chrome verification)` in
`plans/README.md` and report — do NOT mark DONE.

1. Load `dist/` as an unpacked extension in Chrome (`chrome://extensions`,
   Developer mode, Load unpacked).
2. Open the PromptWard side panel → it auto-loads the model. Expected: status
   reaches `Ready in <n> ms` and Diagnostics shows `model-load-progress`
   events ending in `runtime-configured`/`prewarm-end` with no errors.
3. Visit a supported site (e.g. chatgpt.com), type a prompt containing a fake
   SSN like `123-45-6789`, press send. Expected: the review modal appears
   with the SSN replaced by `[SSN_1]`.
4. If the model fails to load, open DevTools on the offscreen document /
   service worker and note which `ort/*` file 404'd — add exactly that file
   to the keep-list, re-run from step 2, and record the addition in the
   commit message.

## Test plan

No new unit tests — coverage is the tightened `verify:assets` (step 3), the
build greps (step 4), and the mandatory runtime gate (step 5).

## Done criteria

- [ ] `public/ort/` contains exactly the keep-list files
- [ ] `npm run verify:assets`, `npm test`, `npm run build`, `npm run package` all exit 0
- [ ] `packages/promptward-extension.zip` is materially smaller than 39 MB (record the number in the commit message)
- [ ] Step 5 manual gate performed and passing (or plan marked BLOCKED)
- [ ] `git status` shows only in-scope files + `plans/README.md`
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- `scripts/vendor-ort.mjs` or the worker WASM config drifted from the excerpts.
- Build-output inspection (step 4) shows an executable load path for a
  non-keep-list ORT file under the current `device: "wasm"` configuration.
- The runtime gate fails even after adding the 404'd file per step 5.4 twice.
- `onnxruntime-web`'s dist layout has changed (keep-list files absent) —
  the dependency was updated; the keep-list needs re-derivation, report.

## Maintenance notes

- If WebGPU support is ever wired (see plan 012's maintenance notes and the
  direction section of `plans/README.md`), the `jsep` pair
  (`ort-wasm-simd-threaded.jsep.{wasm,mjs}`) must be added back to the
  keep-list — the tightened `verify:assets` will force that to be explicit.
- If `onnxruntime-web` is upgraded, re-run `npm run vendor:ort` and repeat
  the step-5 runtime gate; file names have changed across ORT majors before.
- Reviewer focus: the keep-list lives in ONE place (`scripts/assets.mjs`)
  and both scripts import it.
