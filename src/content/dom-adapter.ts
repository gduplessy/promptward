export type EditorHandle = {
  element: HTMLElement;
  getText: () => string;
  setText: (value: string) => void;
};

export function findEditor(start: EventTarget | null): EditorHandle | undefined {
  const root = start instanceof HTMLElement ? start : document.activeElement;
  const candidates = [
    root,
    root instanceof HTMLElement ? root.closest("form") : undefined,
    document.activeElement,
    document.body
  ].filter((item): item is HTMLElement => item instanceof HTMLElement);

  for (const candidate of candidates) {
    const editor = findEditorIn(candidate);
    if (editor) return editor;
  }
  return undefined;
}

export function findEditorIn(root: ParentNode): EditorHandle | undefined {
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) {
    if (root === active || root.contains(active)) return inputHandle(active);
  }
  if (active instanceof HTMLElement && active.isContentEditable && (root === active || root.contains(active))) {
    return contentEditableHandle(active);
  }

  const input = root.querySelector<HTMLTextAreaElement | HTMLInputElement>(
    "textarea, input[type='text'], input:not([type])"
  );
  if (input) return inputHandle(input);

  const editable = root.querySelector<HTMLElement>("[contenteditable='true'], [contenteditable='plaintext-only']");
  if (editable) return contentEditableHandle(editable);

  return undefined;
}

export function inputHandle(element: HTMLTextAreaElement | HTMLInputElement): EditorHandle {
  return {
    element,
    getText: () => element.value,
    setText: (value: string) => {
      element.value = value;
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };
}

export function contentEditableHandle(element: HTMLElement): EditorHandle {
  return {
    element,
    getText: () => element.innerText ?? element.textContent ?? "",
    setText: (value: string) => setContentEditableText(element, value)
  };
}

function setContentEditableText(element: HTMLElement, value: string): void {
  element.focus();
  if (replaceViaExecCommand(element, value)) return;

  element.textContent = value;
  element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Rich-text composers (Lexical, ProseMirror, Draft.js — used by Perplexity,
 * ChatGPT, etc.) keep their own internal document model and ignore a direct
 * `textContent` write: the DOM looks updated but the framework still submits
 * its old state. `execCommand("insertText", ...)` fires the same native
 * input events a real keystroke would, which these editors do listen for.
 */
function replaceViaExecCommand(element: HTMLElement, value: string): boolean {
  if (typeof document.execCommand !== "function") return false;
  const selection = window.getSelection();
  if (!selection) return false;

  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);

  let succeeded = false;
  try {
    succeeded = document.execCommand("insertText", false, value);
  } catch {
    succeeded = false;
  }
  element.dispatchEvent(new Event("change", { bubbles: true }));

  const normalized = (element.innerText ?? element.textContent ?? "").replace(/\r\n/g, "\n").trim();
  return succeeded && normalized === value.trim();
}

export function submitNative(trigger: HTMLElement): void {
  if (trigger instanceof HTMLFormElement) {
    trigger.requestSubmit();
    return;
  }

  if (trigger instanceof HTMLButtonElement || trigger instanceof HTMLInputElement) {
    trigger.click();
    return;
  }

  const form = trigger.closest("form");
  if (form) {
    form.requestSubmit();
    return;
  }

  trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
}
