export type EditorHandle = {
  element: HTMLElement;
  getText: () => string;
  /** Resolves true once the editor's own text actually reflects `value`, false if no
   *  strategy could make it stick (caller must not assume the send is safe in that case). */
  setText: (value: string) => Promise<boolean>;
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
    setText: async (value: string) => {
      element.value = value;
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return element.value === value;
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

const SETTLE_DELAY_MS = 60;

/**
 * Rich-text composers (Lexical, ProseMirror, Draft.js — used by Perplexity,
 * ChatGPT, etc.) keep their own internal document model: a direct `textContent`
 * write updates the DOM but the framework still submits its old state, and some
 * of these editors reconcile their model asynchronously rather than in the same
 * tick as the triggering event. Try several input strategies real editors listen
 * for, giving each a short settle window, before falling back to a raw write.
 */
async function setContentEditableText(element: HTMLElement, value: string): Promise<boolean> {
  element.focus();

  if (await tryStrategy(element, value, execCommandInsert)) return true;
  if (await tryStrategy(element, value, pasteInsert)) return true;
  if (await tryStrategy(element, value, keydownSelectAllThenBeforeInput)) return true;

  element.textContent = value;
  element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  return matchesValue(element, value);
}

async function tryStrategy(
  element: HTMLElement,
  value: string,
  strategy: (element: HTMLElement, value: string) => void
): Promise<boolean> {
  selectAllContent(element);
  strategy(element, value);
  element.dispatchEvent(new Event("change", { bubbles: true }));

  if (matchesValue(element, value)) return true;
  await settle();
  return matchesValue(element, value);
}

function selectAllContent(element: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

function execCommandInsert(_element: HTMLElement, value: string): void {
  if (typeof document.execCommand !== "function") return;
  try {
    document.execCommand("insertText", false, value);
  } catch {
    // ignore - matchesValue() in the caller decides whether this worked
  }
}

function pasteInsert(element: HTMLElement, value: string): void {
  if (typeof ClipboardEvent !== "function" || typeof DataTransfer !== "function") return;
  try {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", value);
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  } catch {
    // ignore - matchesValue() in the caller decides whether this worked
  }
}

function keydownSelectAllThenBeforeInput(element: HTMLElement, value: string): void {
  // Some editors implement Ctrl/Cmd+A themselves (rather than relying on the browser's
  // native selection) and only trust a beforeinput that follows their own select-all.
  const isMac = navigator.platform.toUpperCase().includes("MAC");
  element.dispatchEvent(
    new KeyboardEvent("keydown", { key: "a", code: "KeyA", ctrlKey: !isMac, metaKey: isMac, bubbles: true, cancelable: true })
  );
  element.dispatchEvent(
    new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: value })
  );
}

function matchesValue(element: HTMLElement, value: string): boolean {
  const normalized = (element.innerText ?? element.textContent ?? "").replace(/\r\n/g, "\n").trim();
  return normalized === value.trim();
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, SETTLE_DELAY_MS));
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
