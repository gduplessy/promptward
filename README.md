# PromptWard

PromptWard is a Manifest V3 Chrome extension that redacts prompt PII locally before text is sent to AI chat products.

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
