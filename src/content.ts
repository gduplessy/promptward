import { findEditor, submitNative, type EditorHandle } from "./content/dom-adapter";
import { showReviewModal } from "./content/review-modal";
import { getConversationKey } from "./shared/conversation";
import { MESSAGE_TYPES, type ProtectTextResponse } from "./shared/messages";

const replaying = new WeakSet<HTMLElement>();
const inFlight = new WeakSet<HTMLElement>();

document.addEventListener("click", onClickCapture, true);
document.addEventListener("keydown", onKeydownCapture, true);
document.addEventListener("submit", onSubmitCapture, true);

function onClickCapture(event: MouseEvent): void {
  const trigger = findSubmitTrigger(event.target);
  if (!trigger) return;
  void protectAndMaybeSubmit(event, trigger, findEditor(trigger));
}

function onKeydownCapture(event: KeyboardEvent): void {
  if (event.key !== "Enter") return;
  if (!(event.metaKey || event.ctrlKey || event.shiftKey === false)) return;
  const editor = findEditor(event.target);
  if (!editor) return;
  void protectAndMaybeSubmit(event, editor.element, editor);
}

function onSubmitCapture(event: SubmitEvent): void {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  void protectAndMaybeSubmit(event, form, findEditor(form));
}

async function protectAndMaybeSubmit(event: Event, trigger: HTMLElement, editor: EditorHandle | undefined): Promise<void> {
  if (!editor) return;
  if (replaying.has(trigger)) {
    replaying.delete(trigger);
    return;
  }
  if (inFlight.has(trigger)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }

  const original = editor.getText();
  if (!original.trim()) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  inFlight.add(trigger);

  try {
    const response = await protectText(original);
    if (!response.ok) {
      await handleFailure(response.error ?? "Unable to redact prompt", original, trigger, editor);
      return;
    }

    if (!response.changed) {
      replay(trigger);
      return;
    }

    const decision = await showReviewModal({
      original,
      redacted: response.safeText,
      placeholders: response.placeholders
    });

    if (decision === "confirm") {
      editor.setText(response.safeText);
      replay(trigger);
    } else {
      editor.setText(original);
    }
  } finally {
    inFlight.delete(trigger);
  }
}

async function handleFailure(error: string, original: string, trigger: HTMLElement, editor: EditorHandle): Promise<void> {
  const decision = await showReviewModal({ original, error });
  if (decision === "retry") {
    const response = await protectText(original);
    if (response.ok && !response.changed) {
      replay(trigger);
    } else if (response.ok) {
      editor.setText(response.safeText);
      replay(trigger);
    }
  }
}

async function protectText(text: string): Promise<ProtectTextResponse> {
  return chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.protectText,
    text,
    conversationKey: getConversationKey({ url: location.href }),
    url: location.href
  });
}

function replay(trigger: HTMLElement): void {
  replaying.add(trigger);
  submitNative(trigger);
}

function findSubmitTrigger(target: EventTarget | null): HTMLElement | undefined {
  if (!(target instanceof Element)) return undefined;
  const control = target.closest("button,input,[role='button']");
  if (!(control instanceof HTMLElement)) return undefined;
  return isSubmitControl(control) ? control : undefined;
}

function isSubmitControl(element: HTMLElement): boolean {
  if (element instanceof HTMLButtonElement) {
    return element.type === "submit" || /send|submit/i.test(element.ariaLabel ?? element.textContent ?? "");
  }
  if (element instanceof HTMLInputElement) {
    return element.type === "submit" || element.type === "button";
  }
  return /send|submit/i.test(element.getAttribute("aria-label") ?? element.textContent ?? "");
}
