# Changelog

All notable changes to PromptWard are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The current release number lives in [VERSION](./VERSION); it is the single
source of truth that `package.json`, `src/manifest.ts`, and
`APP_VERSION` (`src/shared/debug.ts`) must all equal. A test
(`tests/manifest.test.ts > keeps every version source equal to the VERSION
file`) enforces this — bump with `npm run bump-version -- <x.y.z>` so all four
update together.

## [0.11.0] - 2026-07-18

Critical fix: protection was silently no-op'ing on the most popular sites.

### Fixed
- **Protection no longer silently skips rich-text composers.** On ChatGPT,
  Perplexity, and Claude (Lexical/ProseMirror editors), the content script
  resolved the wrong contenteditable element — an unrelated empty field (title,
  search) earlier in the DOM — read empty text, and let the send through without
  ever running detection. No modal appeared; the prompt went out unredacted.
  Editor lookup now collects every editable candidate in scope and ranks them,
  preferring the one containing the user's text. Reproduced by a regression test
  (`content flow > resolves the composer over an earlier empty contenteditable`)
  that failed on the pre-fix code and passes now. Diagnostics also now record
  which editor was resolved when an empty editor is ignored, so any future
  regression of this kind is immediately readable in the side panel.

## [0.10.1] - 2026-07-18

Polish and dead-code removal. The headline user-visible change is the removal
of the fake "WebGPU" settings toggle; the rest is internal hardening and
performance work that doesn't change behavior.

### Removed
- **WebGPU settings toggle.** The side panel's "WebGPU" checkbox was labeled
  "Reserved opt-in; WASM remains the default backend" and the stored
  `webGpuEnabled` value was read by no runtime code — the worker hardcodes
  `device: "wasm"`. A visible control with no effect erodes trust in a privacy
  tool, so it's gone. A stale `webGpuEnabled` key left in your sync storage is
  harmlessly ignored. ([plan 012](./plans/012-remove-webgpu-noop-toggle.md))

### Changed
- **Debug logging is no longer on the send critical path.** Every prompt send
  previously paid serialized latency for diagnostics the user never sees — five
  `await`ed log stages around the model call, each a round trip to the
  background worker. Logging in the protect flow is now fire-and-forget.
  Diagnostic events are unchanged; only when they're recorded is deferred.
  ([plan 011](./plans/011-debug-logging-off-critical-path.md))

### Fixed
- **Concurrent debug-log appends no longer lose events.** Two tabs (or the
  burst one send produces across content/background/offscreen/worker contexts)
  could interleave reads and overwrite each other in session storage, losing
  the exact events you need when debugging a race. Appends now serialize
  through a queue. ([plan 011](./plans/011-debug-logging-off-critical-path.md))

### Internal
- Single source of truth for the worker protocol types and `escapeHtml`
  (previously duplicated across the worker/offscreen boundary, where drift
  could silently reintroduce an XSS surface). ([plan 010](./plans/010-dedupe-worker-protocol-and-escapehtml.md))
- README's placeholder-rehydration claim corrected to "planned, not shipped" —
  the per-conversation placeholder maps are kept, but response rehydration is
  not yet wired. ([plan 008](./plans/008-readme-rehydration-claim.md))

## [0.10.0] - 2026-07-18

Reliability and packaging. Adds CI, hardens the offscreen-document lifecycle,
validates custom-domain input, and trims the packaged size by stripping unused
ONNX Runtime WASM variants.

### Fixed
- **Concurrent prompts no longer race the offscreen document.** Two protected
  sends firing at once (e.g. on system wake) could both try to create the
  offscreen document and the second would throw a spurious "Prompt blocked"
  error. Offscreen creation is now serialized. ([plan 005](./plans/005-offscreen-document-race.md))
- **Custom-domain input is validated before permission/registration.** A
  malformed entry could silently corrupt content-script registration and break
  protection across all custom domains. Invalid hosts are now rejected at the
  side panel with a visible error before anything is written. ([plan 009](./plans/009-custom-domain-validation.md))

### Changed
- **Smaller packaged extension.** The build now ships only the ORT WASM
  variant the runtime actually loads (`ort-wasm-simd-threaded.jsep.*`), dropping
  the package from ~93 MB / 26 files to ~23 MB — faster downloads and installs.
  ([plan 007](./plans/007-trim-ort-assets.md)) — **see note below; pending
  manual Chrome runtime verification.**

### Internal
- CI workflow runs `verify:assets`, typecheck, tests, and build on every push,
  so releases no longer ship on whatever was verified locally. ([plan 006](./plans/006-ci-workflow.md))

## [0.9.4] - 2026-07-18

Correctness fixes for the protection flow. Addresses an IME-composition bug, a
retry-path contract gap, unbounded request hangs, and a per-page-load crash
that silently disabled diagnostics.

### Fixed
- **Enter during IME composition no longer triggers a premature send.** Pressing
  Enter to confirm a composition (common in CJK input methods) was treated as a
  send intent and could intercept the keystroke before the composed text
  landed. Composition events (`isComposing` / keyCode 229) are now ignored.
  ([plan 002](./plans/002-ime-composition-enter.md))
- **Retry results now honor the review contract.** A failed-then-retried
  protect request bypassed the review modal on success. Retries now route
  through the same review/response handling as the initial attempt. ([plan 003](./plans/003-retry-flow-review-and-feedback.md))
- **Worker/protect requests can no longer hang indefinitely.** The protect
  round trip and offscreen→worker messages are now bounded by timeouts that
  fail closed (nothing sent) instead of stalling the send forever. ([plan 004](./plans/004-worker-request-timeouts.md))
- **Diagnostics no longer crash on every page load.** A temporal-dead-zone
  `ReferenceError` in content-script init (the module-init log call ran before
  the `debugSettingsPromise` declaration) threw on every import, silently
  disabling diagnostics on supported sites. The declaration is now hoisted
  above its first use. This also fixes `npm test` exiting 1 on an all-green
  run. ([plan 013](./plans/013-fix-debug-settings-tdz.md))

### Internal
- Characterization test suite for the content-script protection flow (16
  tests) added, freezing today's behavior so the fixes above have reviewable
  diffs. ([plan 001](./plans/001-content-flow-characterization-tests.md))

---

### A note on reconstructed version numbers

The 12 plans above all landed in one unreleased sequence since `0.9.3` — no git
tags or GitHub releases were cut for the intermediate versions. `0.9.4`,
`0.10.0`, and `0.10.1` are reconstructed groupings (by priority: P1 fixes, P2
reliability/packaging, P3 polish) that describe the logical progression; the
shipped code is at `0.10.1`. Going forward, each entry in this file will
correspond to a real tagged release cut via `npm run bump-version`.

### Pending verification

[0.10.0]'s ORT asset trim ([plan 007](./plans/007-trim-ort-assets.md)) is
statically and build-verified but has not yet been confirmed by loading the
built extension in Chrome and watching the model reach "Ready". See
[plans/README.md](./plans/README.md) for the blocking note.
