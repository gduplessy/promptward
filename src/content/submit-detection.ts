export function findSubmitTrigger(target: EventTarget | null): HTMLElement | undefined {
  if (!(target instanceof Element)) return undefined;
  const control = target.closest("button,input,[role='button']");
  if (!(control instanceof HTMLElement)) return undefined;
  return isSubmitControl(control) ? control : undefined;
}

export function isSubmitControl(element: HTMLElement): boolean {
  if (element instanceof HTMLButtonElement) {
    return element.type === "submit" || /send|submit/i.test(element.ariaLabel ?? element.textContent ?? "");
  }
  if (element instanceof HTMLInputElement) {
    return element.type === "submit" || element.type === "button";
  }
  return /send|submit/i.test(element.getAttribute("aria-label") ?? element.textContent ?? "");
}
