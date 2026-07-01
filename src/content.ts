import { findEditor, submitNative, type EditorHandle } from "./content/dom-adapter";
import { showReviewModal } from "./content/review-modal";
import { findSubmitTrigger } from "./content/submit-detection";
import { APP_VERSION, textSummary, type DebugLogInput, type DebugSettings } from "./shared/debug";
import { getConversationKey } from "./shared/conversation";
import { MESSAGE_TYPES, type DebugSettingsResponse, type ProtectTextResponse } from "./shared/messages";

const replaying = new WeakSet<HTMLElement>();
const inFlight = new WeakSet<HTMLElement>();

document.addEventListener("click", onClickCapture, true);
document.addEventListener("keydown", onKeydownCapture, true);
document.addEventListener("submit", onSubmitCapture, true);
void logDebug({
  debugId: "content-init",
  stage: "listeners-installed",
  level: "info",
  metadata: { version: APP_VERSION, href: location.href }
});

function onClickCapture(event: MouseEvent): void {
  const trigger = findSubmitTrigger(event.target);
  const debugId = crypto.randomUUID();
  void logDebug({
    debugId,
    stage: trigger ? "click-captured" : "click-ignored",
    level: trigger ? "debug" : "info",
    metadata: {
      target: describeElement(event.target),
      trigger: trigger ? describeElement(trigger) : undefined
    }
  });
  if (!trigger) return;
  runProtectionFlow(protectAndMaybeSubmit(event, trigger, findEditor(trigger), debugId), debugId);
}

function onKeydownCapture(event: KeyboardEvent): void {
  if (event.key !== "Enter") return;
  if (!(event.metaKey || event.ctrlKey || event.shiftKey === false)) return;
  const editor = findEditor(event.target);
  const debugId = crypto.randomUUID();
  void logDebug({
    debugId,
    stage: editor ? "keydown-captured" : "keydown-editor-missed",
    level: editor ? "debug" : "warn",
    metadata: {
      key: event.key,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      target: describeElement(event.target),
      editor: editor ? describeElement(editor.element) : undefined
    }
  });
  if (!editor) return;
  runProtectionFlow(protectAndMaybeSubmit(event, editor.element, editor, debugId), debugId);
}

function onSubmitCapture(event: SubmitEvent): void {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  const debugId = crypto.randomUUID();
  const editor = findEditor(form);
  const submitter = event.submitter;
  const submitTrigger = submitter instanceof HTMLElement ? findSubmitTrigger(submitter) : undefined;
  void logDebug({
    debugId,
    stage: editor ? "submit-captured" : "submit-editor-missed",
    level: editor ? "debug" : "warn",
    metadata: {
      form: describeElement(form),
      submitter: submitter instanceof HTMLElement ? describeElement(submitter) : undefined,
      submitTrigger: submitTrigger ? describeElement(submitTrigger) : undefined,
      editor: editor ? describeElement(editor.element) : undefined
    }
  });
  if (submitter instanceof HTMLElement && !submitTrigger) {
    void logDebug({
      debugId,
      stage: "submit-ignored",
      level: "info",
      metadata: { reason: "submitter-not-send-control", submitter: describeElement(submitter) }
    });
    return;
  }
  runProtectionFlow(protectAndMaybeSubmit(event, submitTrigger ?? form, editor, debugId), debugId);
}

async function protectAndMaybeSubmit(event: Event, trigger: HTMLElement, editor: EditorHandle | undefined, debugId = crypto.randomUUID()): Promise<void> {
  if (!editor) {
    await logDebug({
      debugId,
      stage: "editor-missed",
      level: "warn",
      metadata: { eventType: event.type, trigger: describeElement(trigger) }
    });
    return;
  }
  if (replaying.has(trigger)) {
    replaying.delete(trigger);
    await logDebug({
      debugId,
      stage: "replay-allowed",
      level: "debug",
      metadata: { trigger: describeElement(trigger), eventType: event.type }
    });
    return;
  }
  if (inFlight.has(trigger)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }

  const original = editor.getText();
  if (!original.trim()) {
    const emptySummary = await textSummary(original);
    await logDebug({
      debugId,
      stage: "empty-editor-ignored",
      level: "info",
      metadata: emptySummary
    });
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();
  inFlight.add(trigger);

  try {
    const originalSummary = await textSummary(original);
    await logDebug({
      debugId,
      stage: "editor-read",
      level: "debug",
      metadata: {
        eventType: event.type,
        trigger: describeElement(trigger),
        editor: describeElement(editor.element),
        ...originalSummary
      },
      raw: { original }
    });
    await logDebug({
      debugId,
      stage: "protect-request",
      level: "debug",
      metadata: originalSummary
    });
    const response = await protectText(original, debugId);
    await logDebug({
      debugId,
      stage: "protect-response",
      level: response.ok ? "debug" : "error",
      metadata: {
        ok: response.ok,
        changed: response.ok ? response.changed : undefined,
        durationMs: response.ok ? response.durationMs : undefined,
        placeholderCount: response.ok ? response.placeholders.length : undefined,
        error: response.error
      },
      raw: response.ok ? { redacted: response.safeText } : undefined
    });
    if (!response.ok) {
      await handleFailure(response.error ?? "Unable to redact prompt", original, trigger, editor, debugId);
      return;
    }

    if (!response.changed) {
      await logDebug({
        debugId,
        stage: "unchanged-replay",
        level: "warn",
        metadata: { reason: "protect-returned-unchanged" },
        raw: { original }
      });
      replay(trigger, debugId);
      return;
    }

    const decision = await showReviewModal({
      original,
      redacted: response.safeText,
      placeholders: response.placeholders
    });

    if (decision === "confirm") {
      editor.setText(response.safeText);
      const readback = editor.getText();
      await logDebug({
        debugId,
        stage: "editor-set",
        level: "debug",
        metadata: {
          ...(await textSummary(readback)),
          readbackMatchesRedacted: readback === response.safeText
        },
        raw: { redacted: response.safeText, readback }
      });
      replay(trigger, debugId);
    } else if (decision === "original") {
      editor.setText(original);
      await logDebug({
        debugId,
        stage: "review-send-original",
        level: "info",
        metadata: { placeholderCount: response.placeholders.length }
      });
      replay(trigger, debugId);
    } else {
      editor.setText(original);
      await logDebug({
        debugId,
        stage: "review-cancelled",
        level: "info",
        metadata: {}
      });
    }
  } finally {
    inFlight.delete(trigger);
  }
}

function runProtectionFlow(flow: Promise<void>, debugId: string): void {
  void flow.catch((error: unknown) => {
    void logDebug({
      debugId,
      stage: "protect-flow-error",
      level: "error",
      metadata: { error: formatError(error) }
    }).catch(() => undefined);
  });
}

function formatError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

async function handleFailure(error: string, original: string, trigger: HTMLElement, editor: EditorHandle, debugId: string): Promise<void> {
  const decision = await showReviewModal({ original, error });
  if (decision === "retry") {
    const response = await protectText(original, debugId);
    if (response.ok && !response.changed) {
      replay(trigger, debugId);
    } else if (response.ok) {
      editor.setText(response.safeText);
      replay(trigger, debugId);
    }
  }
}

async function protectText(text: string, debugId: string): Promise<ProtectTextResponse> {
  return chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.protectText,
    text,
    conversationKey: getConversationKey({ url: location.href }),
    url: location.href,
    debugId
  });
}

function replay(trigger: HTMLElement, debugId: string): void {
  void logDebug({
    debugId,
    stage: "native-replay",
    level: "debug",
    metadata: { trigger: describeElement(trigger) }
  });
  replaying.add(trigger);
  submitNative(trigger);
}

async function logDebug(input: Omit<DebugLogInput, "context" | "url" | "version">): Promise<void> {
  const settings = await getDebugSettings();
  const event: DebugLogInput = {
    ...input,
    context: "content",
    url: location.href,
    version: APP_VERSION,
    raw: settings.rawDiagnosticsEnabled ? input.raw : undefined
  };
  console.debug("[PromptWard]", event);
  await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.debugLog, event }).catch(() => undefined);
}

let debugSettingsPromise: Promise<DebugSettings> | undefined;

async function getDebugSettings(): Promise<DebugSettings> {
  debugSettingsPromise ??= chrome.runtime
    .sendMessage({ type: MESSAGE_TYPES.getDebugSettings })
    .then((settings: DebugSettingsResponse) => settings)
    .catch(() => ({ rawDiagnosticsEnabled: false }));
  return debugSettingsPromise;
}

function describeElement(target: EventTarget | null): Record<string, unknown> | undefined {
  if (!(target instanceof Element)) return undefined;
  return {
    tag: target.tagName.toLowerCase(),
    id: target.id || undefined,
    role: target.getAttribute("role") || undefined,
    ariaLabel: target.getAttribute("aria-label") || undefined,
    testId: target.getAttribute("data-testid") || undefined,
    type: target.getAttribute("type") || undefined,
    disabled: target instanceof HTMLButtonElement || target instanceof HTMLInputElement ? target.disabled : undefined,
    text: target.textContent?.trim().slice(0, 40) || undefined
  };
}
