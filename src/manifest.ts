import type { ManifestV3Export } from "@crxjs/vite-plugin";

export const KNOWN_AI_MATCHES = [
  "https://chatgpt.com/*",
  "https://chat.openai.com/*",
  "https://claude.ai/*",
  "https://gemini.google.com/*",
  "https://www.perplexity.ai/*",
  "https://chat.mistral.ai/*"
] as const;

export const manifest: ManifestV3Export = {
  manifest_version: 3,
  name: "PromptWard",
  version: "0.1.0",
  description: "Redact prompt PII locally before sending text to AI chat products.",
  minimum_chrome_version: "116",
  action: {
    default_title: "PromptWard"
  },
  background: {
    service_worker: "src/background.ts",
    type: "module"
  },
  side_panel: {
    default_path: "src/sidepanel.html"
  },
  permissions: ["storage", "offscreen", "sidePanel", "scripting", "tabs"],
  host_permissions: [...KNOWN_AI_MATCHES],
  optional_host_permissions: ["https://*/*", "http://*/*"],
  content_scripts: [
    {
      matches: [...KNOWN_AI_MATCHES],
      js: ["src/content.ts"],
      run_at: "document_start",
      all_frames: true
    }
  ],
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
  }
};
