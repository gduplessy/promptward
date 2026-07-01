# PromptWard

PromptWard is a Manifest V3 Chrome extension that redacts prompt PII locally before text is sent to AI chat products (ChatGPT, Claude, Gemini, Perplexity, Mistral). Detection runs entirely on-device via a local ONNX model — no prompt text is ever sent to a server.

## Install (no build required)

1. Download the latest `promptward-extension.zip` from [Releases](https://github.com/gduplessy/promptward/releases/latest).
2. Unzip it somewhere permanent (don't delete the folder afterward — Chrome loads the extension from it).
3. Go to `chrome://extensions`, enable **Developer mode** (top right).
4. Click **Load unpacked** and select the unzipped folder.
5. Click the PromptWard icon in your toolbar to open the side panel; it loads the local model automatically the first time.
6. Visit a supported AI chat site and send a prompt containing PII — PromptWard will show a redaction review before it goes out.

Built-in sites: `chatgpt.com`, `chat.openai.com`, `claude.ai`, `gemini.google.com`, `www.perplexity.ai`, `chat.mistral.ai`. Add any other site from the side panel's Custom Domains section.

See [PRIVACY.md](./PRIVACY.md) for what does (and doesn't) leave your device, and [NOTICE](./NOTICE) for third-party model/runtime attribution.

## Local model constraint

- Rampart model files are packaged under `public/models/rampart/`.
- ONNX Runtime Web WASM files are packaged under `public/ort/`.
- Runtime remote model loading is disabled in `src/rampart-worker.ts`.
- `models/**` and `ort/**` are intentionally not listed in `web_accessible_resources`.

## Development

```sh
npm install
npm run vendor:rampart
npm run vendor:ort
npm test
npm run build
```

Load `dist/` as an unpacked Chrome extension.
