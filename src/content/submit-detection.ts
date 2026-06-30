export function findSubmitTrigger(target: EventTarget | null): HTMLElement | undefined {
  if (!(target instanceof Element)) return undefined;
  const control = target.closest("button,input,[role='button']");
  if (!(control instanceof HTMLElement)) return undefined;
  return isSubmitControl(control) ? control : undefined;
}

export function isSubmitControl(element: HTMLElement): boolean {
  if (isDisabledControl(element)) return false;

  if (element instanceof HTMLButtonElement) {
    return hasSendSignal(element) || (element.type === "submit" && hasPromptFormContext(element));
  }
  if (element instanceof HTMLInputElement) {
    return (element.type === "submit" || element.type === "button") && hasSendSignal(element);
  }
  return hasSendSignal(element);
}

function isDisabledControl(element: HTMLElement): boolean {
  if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) return element.disabled;
  return element.getAttribute("aria-disabled") === "true";
}

function hasSendSignal(element: HTMLElement): boolean {
  const signals = [
    element.getAttribute("aria-label"),
    element.getAttribute("data-testid"),
    element.getAttribute("data-test-id"),
    element.getAttribute("title"),
    element.getAttribute("name"),
    element.textContent
  ];
  return signals.some((value) => /\b(send|submit)\b|send-button|composer-submit/i.test(value ?? ""));
}

function hasPromptFormContext(element: HTMLElement): boolean {
  const form = element.closest("form");
  if (!form) return false;
  return Boolean(form.querySelector("textarea,[contenteditable='true'],[contenteditable='plaintext-only']"));
}
