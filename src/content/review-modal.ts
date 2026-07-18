import type { PlaceholderSummary } from "../shared/messages";
import { escapeHtml } from "../shared/html";

export type ReviewDecision = "confirm" | "cancel" | "retry" | "original";

export const AUTO_CONFIRM_SECONDS = 5;

export function showReviewModal(options: {
  original: string;
  redacted?: string;
  placeholders?: PlaceholderSummary[];
  error?: string;
}): Promise<ReviewDecision> {
  return new Promise((resolve) => {
    const host = document.createElement("promptward-review");
    const shadow = host.attachShadow({ mode: "open" });
    const isError = Boolean(options.error);
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .backdrop {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          background: rgba(15, 23, 42, 0.42);
          display: grid;
          place-items: center;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .panel {
          width: min(680px, calc(100vw - 32px));
          max-height: min(720px, calc(100vh - 32px));
          overflow: auto;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          background: #ffffff;
          color: #0f172a;
          box-shadow: 0 24px 80px rgba(15, 23, 42, 0.3);
        }
        header, footer { padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        header { border-bottom: 1px solid #e2e8f0; }
        footer { border-top: 1px solid #e2e8f0; justify-content: flex-end; }
        h2 { margin: 0; font-size: 15px; line-height: 20px; font-weight: 650; }
        .body { padding: 16px; display: grid; gap: 14px; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .box { border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; min-width: 0; }
        .label { padding: 8px 10px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 12px; font-weight: 650; color: #475569; }
        pre { margin: 0; padding: 10px; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace; max-height: 300px; overflow: auto; }
        .chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .chip { border: 1px solid #cbd5e1; border-radius: 999px; padding: 3px 8px; font: 12px/18px ui-monospace, SFMono-Regular, Consolas, monospace; color: #334155; background: #f8fafc; }
        .error { border: 1px solid #fecaca; background: #fef2f2; color: #991b1b; border-radius: 6px; padding: 10px; font-size: 13px; line-height: 18px; }
        button { appearance: none; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #0f172a; padding: 8px 12px; font: 13px/18px inherit; cursor: pointer; }
        button.primary { border-color: #0f172a; background: #0f172a; color: #fff; }
        @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }
      </style>
      <div class="backdrop" role="dialog" aria-modal="true" aria-label="PromptWard review">
        <section class="panel">
          <header><h2>${isError ? "Prompt blocked" : "Review redacted prompt"}</h2></header>
          <div class="body">
            ${
              isError
                ? `<div class="error">${escapeHtml(options.error ?? "PromptWard could not redact this prompt.")}</div>`
                : `<div class="grid">
                    <div class="box"><div class="label">Original</div><pre>${escapeHtml(options.original)}</pre></div>
                    <div class="box"><div class="label">Redacted</div><pre>${escapeHtml(options.redacted ?? "")}</pre></div>
                  </div>
                  <div class="chips">${(options.placeholders ?? []).map((item) => `<span class="chip">${escapeHtml(item.token)}</span>`).join("")}</div>`
            }
          </div>
          <footer>
            <button data-action="cancel">Cancel</button>
            ${
              isError
                ? `<button data-action="retry">Retry</button>`
                : `<button data-action="original">Send original</button>
                   <button class="primary" data-action="confirm">Send redacted (${AUTO_CONFIRM_SECONDS}s)</button>`
            }
          </footer>
        </section>
      </div>
    `;

    let countdownTimer: ReturnType<typeof setInterval> | undefined;

    const finish = (decision: ReviewDecision): void => {
      if (countdownTimer !== undefined) clearInterval(countdownTimer);
      host.remove();
      resolve(decision);
    };

    shadow.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const action = target.dataset.action as ReviewDecision | undefined;
      if (!action) return;
      finish(action);
    });

    if (!isError) {
      const confirmButton = shadow.querySelector<HTMLButtonElement>("[data-action='confirm']");
      let remaining = AUTO_CONFIRM_SECONDS;

      const cancelCountdown = (): void => {
        if (countdownTimer === undefined) return;
        clearInterval(countdownTimer);
        countdownTimer = undefined;
        if (confirmButton) confirmButton.textContent = "Send redacted";
      };

      // The countdown covers users who stepped away from the keyboard: censoring
      // stays the default. Any activity inside the modal means the user is
      // reviewing, so hand control back to them.
      shadow.addEventListener("pointermove", cancelCountdown);
      shadow.addEventListener("pointerdown", cancelCountdown);
      shadow.addEventListener("keydown", cancelCountdown);

      countdownTimer = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          finish("confirm");
          return;
        }
        if (confirmButton) confirmButton.textContent = `Send redacted (${remaining}s)`;
      }, 1000);
    }

    document.documentElement.append(host);
  });
}

