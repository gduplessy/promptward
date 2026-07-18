# AGENTS.md

Guidance for coding agents (and humans) working in this repository. Read this
before making changes.

## What this is

PromptWard is a Manifest V3 Chrome extension that catches PII in prompts
before they reach ChatGPT, Claude, Gemini, Perplexity, and Mistral. Detection
and redaction run entirely on-device — a local ONNX token-classification model
([Rampart](https://huggingface.co/nationaldesignstudio/rampart)) plus
regex/checksum heuristics (SSN, Luhn-validated cards, email, phone). No prompt
text or telemetry ever leaves the machine.

- **Repo:** https://github.com/gduplessy/promptward
- **License:** MIT (code); vendored Rampart model (CC-BY-4.0) and ONNX Runtime
  Web assets carry separate licenses — see [NOTICE](./NOTICE).
- **Privacy posture:** [PRIVACY.md](./PRIVACY.md). The no-telemetry guarantee
  is load-bearing — never add a network call that sends prompt text, the
  placeholder map, or anything user-derived off-device.

## Layout

```
src/
  manifest.ts          Chrome MV3 manifest (version, permissions, CSP)
  background.ts        service worker — message routing, offscreen lifecycle,
                       debug-log storage (serialized via appendQueue)
  content.ts           content script — intercepts sends, runs protect flow,
                       shows review modal. The send critical path.
  content/             DOM adapters (editor read/write, submit detection,
                       review modal) — site-specific glue lives here
  offscreen.ts         offscreen document host — owns the worker
  rampart-worker.ts    Web Worker — loads + runs the ONNX model + heuristics.
                       device: "wasm" hardcoded; remote loading disabled.
  sidepanel.ts/.html   the UI — settings, model status, diagnostics
  shared/              debug.ts (APP_VERSION + event schema), messages.ts
                       (the cross-context protocol — single source of truth),
                       settings.ts, html.ts (escapeHtml), timeout.ts,
                       conversation.ts, model-progress.ts
public/
  models/rampart/      vendored Rampart model (large; not in git LFS)
  ort/                 vendored ONNX Runtime Web WASM — only the jsep variant
                       the runtime loads is kept (see plans/007)
scripts/               build/package/vendor helpers — bump-version.mjs,
                       verify-assets.mjs, vendor-{ort,rampart-model}.mjs,
                       package-extension.mjs, assets.mjs
tests/                 vitest, jsdom env. helpers/chrome-stub.ts is the
                       chrome.runtime.sendMessage stub used everywhere.
plans/                 implementation plans + README.md status index
VERSION                canonical release number — single source of truth
CHANGELOG.md           release history (Keep a Changelog format)
```

## Commands

| Purpose | Command |
|---|---|
| Install deps | `npm install` |
| Typecheck | `npx tsc -p tsconfig.json --noEmit` |
| Run tests | `npm test` (vitest, jsdom, 79+ tests) |
| Build | `npm run build` (verify:assets → tsc → vite build → `dist/`) |
| Repackage zip | `npm run package` |
| Bump version | `npm run bump-version -- <x.y.z>` |
| Dev server | `npm run dev` |

Always run typecheck + tests + build before considering work done. CI
(`.github/workflows/ci.yml`) runs all three on push.

## Versioning — MANDATORY on every change

**Every change must update the version**, and the version is enforced to be
consistent across the repo. `VERSION` is the single source of truth;
`package.json`, `src/manifest.ts`, and `APP_VERSION` (`src/shared/debug.ts`)
must all equal it. A test
(`tests/manifest.test.ts > keeps every version source equal to the VERSION
file`) fails on drift — do not hand-edit one source, or reloading the
unpacked extension will silently show the old number in
`chrome://extensions`.

**Bump with one command** (updates VERSION + the three sources together):

```sh
npm run bump-version -- <x.y.z>
```

### Version bump policy

Follow this severity scale when deciding which number to bump:

| Change kind | Bump | Examples |
|---|---|---|
| Major change | `x.0.0` | new feature, significant behavior change, manifest/permissions change, schema or protocol break |
| Critical bug fix | `0.x.0` | data-loss, privacy leak, crash on the send path, protection silently failing |
| Minor bug fix | `0.0.x` | cosmetic, diagnostic-only, internal refactor, docs |

While still in `0.x`, treat the leading `0` per the spirit of the rule above
(i.e. a "major change" today is `0.x.0` with a clear changelog entry; flip to
`1.0.0` semantics when the project declares a stable release).

### When you bump

1. Run `npm run bump-version -- <new-version>`.
2. Add an entry to the top of [CHANGELOG.md](./CHANGELOG.md) under the new
   version, grouped by Added / Changed / Removed / Fixed / Internal as
   relevant. Cite the plan or issue if there is one.
3. Re-run `npm test` to confirm the version-sync test passes.
4. The bump is its own commit (`chore(release): bump to x.y.z`), separate
   from feature work, unless the change is a single-fix release.

## How the protect flow fits together

1. `content.ts` intercepts click/Enter/submit on supported sites (capture
   phase, before the page's own handler).
2. Prompt text → `background.ts` → offscreen document → `rampart-worker.ts`
   (ONNX model + heuristics). This hop exists so model state survives
   service-worker suspension.
3. If PII found → review modal (original vs. redacted). Auto-sends redacted
   after 5s idle, with explicit **Send original** / cancel.
4. `content.ts` writes redacted text back into the composer (trying
   `execCommand`, synthetic paste, then a select-all + `beforeinput`
   sequence) and **fail-closed**: it only replays the send once it can verify
   the redacted text actually landed. An incompatible composer blocks sends
   with a visible error rather than leak PII.

The placeholder map (`[PERSON_1]` → real value) is per-conversation, in
memory only. **Response rehydration is not wired** — model replies show the
tokens as-is. See [plans/008](./plans/008-readme-rehydration-claim.md).

## Working with plans

`plans/README.md` is the status index. Each plan file has executor
instructions, STOP conditions, scope, and done criteria — read the plan fully
before starting, honor its STOP conditions, and flip its status row when
done. Don't improvise past a STOP condition; report instead.

## Gotchas

- **Windows + vendored WASM:** a fresh `git worktree add` can reconvert
  `public/ort/*.mjs` line endings and break `verify:assets`. Fix with
  `git -c core.autocrlf=false checkout -- public/`.
- **`@crxjs/vite-plugin`** is pinned at a beta; builds fine, but watch it.
- The `dist/` "new URL ... doesn't exist at build time" warning for
  `ort-wasm-simd-threaded.jsep.wasm` is expected (resolved at runtime).
- The worker hardcodes `device: "wasm"`. If you ever wire WebGPU, you must
  also add the `jsep` pair back to the ORT keep-list (see
  [plans/007](./plans/007-trim-ort-assets.md) maintenance notes) and revisit
  the prewarm timeout in [plans/004](./plans/004-worker-request-timeouts.md).
