import { vi } from "vitest";
import type { ProtectTextResponse } from "../../src/shared/messages";

export type ChromeStub = {
  chrome: { runtime: { sendMessage: ReturnType<typeof vi.fn> } };
  /** Queue the response for the next PW_PROTECT_TEXT message. */
  setProtectResponse(response: ProtectTextResponse): void;
  /** Queue a resolver function for the next PW_PROTECT_TEXT message, letting the
   *  test control exactly when the response resolves (for in-flight tests). */
  setProtectResponder(responder: () => Promise<ProtectTextResponse>): void;
  sentMessages: Array<Record<string, unknown>>;
};

export function installChromeStub(): ChromeStub {
  const sentMessages: Array<Record<string, unknown>> = [];
  let protectResponse: ProtectTextResponse = {
    ok: true,
    safeText: "",
    changed: false,
    placeholders: [],
    durationMs: 1
  };
  let protectResponder: (() => Promise<ProtectTextResponse>) | undefined;

  const sendMessage = vi.fn(async (message: Record<string, unknown>) => {
    sentMessages.push(message);
    switch (message.type) {
      case "PW_GET_DEBUG_SETTINGS":
        return { rawDiagnosticsEnabled: false };
      case "PW_DEBUG_LOG":
        return { ok: true };
      case "PW_PROTECT_TEXT":
        if (protectResponder) return protectResponder();
        return protectResponse;
      default:
        return { ok: true };
    }
  });

  const stub = { runtime: { sendMessage } };
  vi.stubGlobal("chrome", stub);

  return {
    chrome: stub,
    setProtectResponse: (r) => {
      protectResponder = undefined;
      protectResponse = r;
    },
    setProtectResponder: (responder) => {
      protectResponder = responder;
    },
    sentMessages
  };
}
