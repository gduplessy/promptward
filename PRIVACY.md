# Privacy

PromptWard runs PII detection and redaction locally in the browser extension.

- Prompt content is not collected, stored, or sent to PromptWard servers.
- Placeholder maps stay in extension memory and are cleared on navigation, tab close, extension reload, or user reset.
- Settings are stored in `chrome.storage.sync` and do not include prompt text.
- The packaged Rampart model and ONNX Runtime Web assets are loaded from the extension bundle.
