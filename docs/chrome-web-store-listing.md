# Chrome Web Store listing — PromptWard

Copy-paste source for the Chrome Web Store submission form. Each section maps to
a field in the [Developer Dashboard](https://chrome.google.com/webstore/devconsole/).
Keep in sync with `README.md` / `PRIVACY.md` when the extension changes.

Last updated for: **0.11.1**

---

## Listing tab

### Name (max 75 chars)

```
PromptWard — local prompt PII guard
```

### Summary (max 132 chars)

```
Locally redact personal data (names, SSNs, emails, phones) from your prompts before they reach ChatGPT, Claude, Gemini & more.
```

### Category

```
Productivity
```

### Language

```
English
```

### Detailed description (max 16,000 chars)

```
PromptWard catches personal information in your prompts before it reaches ChatGPT, Claude, Gemini, Perplexity, or Mistral — and redacts it locally, on your device. No prompt text, no placeholder map, and no telemetry ever leaves your browser.

HOW IT WORKS
When you press send on a supported AI chat site, PromptWard briefly intercepts the prompt, runs a local ONNX model (Rampart) plus deterministic heuristics to find personally identifiable information — names, Social Security numbers, credit card numbers, email addresses, phone numbers — and shows you a side-by-side review: your original prompt next to the redacted version. Identifiers are replaced with reversible placeholder tokens like [PERSON_1] or [SSN_1].

The redacted version is the default. If you step away from the keyboard, it auto-sends after a 5-second countdown. You can also click to take manual control, send the original unchanged, or cancel.

PRIVACY-FIRST BY DESIGN
- Detection runs 100% on-device. There is no PromptWard server. Your prompts are never transmitted anywhere to be classified.
- The placeholder map that would reverse [PERSON_1] back to the real name is held only in extension memory and cleared on navigation, tab close, or reload.
- No accounts, no analytics, no telemetry. Settings store only your preferences, never prompt content.

(Note: model responses are not yet rehydrated — if the assistant references a redacted value, you'll see the placeholder token rather than the original text. The placeholder maps that would enable this are kept per conversation and can be wired up later.)

SUPPORTED SITES
Works out of the box on ChatGPT (chatgpt.com, chat.openai.com), Claude (claude.ai), Gemini (gemini.google.com), Perplexity (perplexity.ai), and Mistral (chat.mistral.ai). Add any other site from the side panel's Custom Domains list — PromptWard will request permission for just that site.

BY WHOM
Built for anyone who has ever pasted a customer's details, a real SSN, or a colleague's contact info into a chat window and immediately wished they hadn't. Assistive, not a compliance guarantee: it can miss PII in unusual formatting and will occasionally flag harmless text. Always review the redacted version before sending.

OPEN SOURCE
MIT licensed. Source, model attribution, and the full privacy posture are at https://github.com/gduplessy/promptward.
```

---

## Graphics tab

| Asset | Spec | Source file |
|---|---|---|
| Icon 128×128 | required | `src/sidepanel.css` / derive from brand — TODO: produce a dedicated `icon-128.png` |
| Small promo tile 440×280 | required | TODO |
| Marquee promo 1400×560 | optional | TODO |
| Screenshot 1280×800 | required (1–5) | `docs/screenshot.png` |

The existing `docs/screenshot.png` shows the review modal with original vs. redacted text — usable as the primary screenshot. The Store wants 1280×800; verify/crop before upload.

---

## Privacy practices tab

These map directly to the questionnaire. Answer truthfully per `PRIVACY.md`.

### Permissions justification (free-text boxes in the form)

**`offscreen`**

```
Used to host the local ONNX inference model in a detached offscreen document so the model and its WASM runtime persist across service-worker suspensions (a Manifest V3 requirement). No UI is shown from the offscreen document; it only runs the model and returns redacted text to the content script via the service worker.
```

**`sidePanel`**

```
Provides the extension's settings UI: enable/disable protection, add custom domains, view local diagnostics, and trigger a model reload. The side panel is the only user-facing surface; no prompt content is displayed there.
```

**`tabs` + `host_permissions` (the built-in AI sites)**

```
Required so the content script can intercept the send action (click or Enter) on the supported AI chat composer before the page's own handler runs, read the prompt text locally, write the redacted text back, and replay the send. Host permissions are scoped to the six supported AI chat domains (chatgpt.com, claude.ai, gemini.google.com, perplexity.ai, chat.mistral.ai, chat.openai.com).
```

**`optional_host_permissions: ["https://*/*", "http://*/*"]`**

```
Optional — requested at runtime via chrome.permissions.request ONLY when the user explicitly adds a custom domain in the side panel. PromptWard never requests broad host access on install; it requests the single user-chosen host, with a native Chrome permission prompt, at the moment the user adds it. This is what lets users extend protection to any AI chat site beyond the five built-in ones. The wildcard is required because the custom domain is user-supplied at runtime and not known at build time.
```

**`wasm-unsafe-eval` in content_security_policy**

```
Required by ONNX Runtime Web (onnxruntime-web), which PromptWard uses to run the local Rampart PII-detection model. The WASM binary is packaged inside the extension; no remote scripts or code are loaded or evaluated. The `wasm-unsafe-eval` keyword is the documented MV3 mechanism for WebAssembly execution and does not permit arbitrary string-to-code evaluation.
```

### Data usage declarations

| Question | Answer |
|---|---|
| Does this collect personally identifiable information? | **No** |
| Does this collect authentication information? | **No** |
| Does this collect personal communications? | **No** |
| Does this collect financial and payment information? | **No** |
| Does this collect health information? | **No** |
| Is authentication required to use the extension? | **No** |
| Is this sold to a third party? | **No** |
| Is it used for creditworthiness or lending? | **No** |
| Remote code loaded? | **No** — all code and the model are packaged in the extension bundle. |

### Privacy policy URL

Host `PRIVACY.md` via GitHub Pages and point the form field at it, e.g.:
```
https://github.com/gduplessy/promptward/blob/master/PRIVACY.md
```
(Better: enable GitHub Pages on the repo so it's a clean `https://gduplessy.github.io/promptward/privacy/` — the raw GitHub link works but reviewers sometimes prefer a rendered page.)

### Single purpose (max 132 chars)

```
Locally detect and redact personally identifiable information from prompts before they are sent to AI chat websites.
```

---

## Account tab

- **Developer fee:** one-time $5 Google Pay fee.
- **Registration:** individual or organization account. Organization requires
  domain verification — use individual for first submission.

---

## Submission checklist (do before clicking Submit)

- [ ] `npm test` exits 0; `npm run build` exits 0; `dist/manifest.json` version matches `VERSION`.
- [ ] `npm run package` regenerates `packages/promptward-extension.zip` from a clean build.
- [ ] Zip is under 100 MB main-package limit (currently ~24 MB — comfortable headroom).
- [ ] Upload the zip on the Package tab (not Load Unpacked — the Store needs the packaged bundle).
- [ ] Icon 128×128 present (TODO above — currently no dedicated icon asset).
- [ ] At least one 1280×800 screenshot.
- [ ] Privacy policy URL reachable.
- [ ] All five permission justifications above pasted into their form fields — reviewers reject silent broad permissions, especially `optional_host_permissions: https://*/*`.
- [ ] Source code: not required to be public, but since it's MIT on GitHub, linking it strengthens the trust signal for a privacy tool.
