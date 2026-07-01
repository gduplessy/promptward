import { BUILT_IN_HOSTS, DEFAULT_SETTINGS, loadSettings, normalizeHost } from "./shared/settings";
import {
  MESSAGE_TYPES,
  type DebugLogsResponse,
  type DebugSettingsResponse,
  type PrewarmModelResponse,
  type PromptWardSettings
} from "./shared/messages";
import { computeModelProgress } from "./shared/model-progress";
import "./sidepanel.css";

const appRoot = getAppRoot();

void (async () => {
  await render();
  await startPrewarm();
})().catch((error: unknown) => {
  console.error("[PromptWard] side panel init failed", error);
});

async function render(status = "Idle"): Promise<void> {
  const settings = await loadSettings();
  const debugSettings = (await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.getDebugSettings })) as DebugSettingsResponse;
  const debugLogs = (await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.getDebugLogs })) as DebugLogsResponse;
  appRoot.innerHTML = `
    <section class="shell">
      <header>
        <h1>PromptWard</h1>
        <span id="status" class="status">${escapeHtml(status)}</span>
      </header>

      <section class="group">
        <label class="row">
          <span>
            <strong>Protection</strong>
            <small>Block prompt sends until local redaction completes.</small>
          </span>
          <input id="enabled" type="checkbox" ${settings.enabled ? "checked" : ""} />
        </label>
        <label class="row">
          <span>
            <strong>WebGPU</strong>
            <small>Reserved opt-in; WASM remains the default backend.</small>
          </span>
          <input id="webgpu" type="checkbox" ${settings.webGpuEnabled ? "checked" : ""} />
        </label>
      </section>

      <section class="group">
        <h2>Model</h2>
        <p class="empty">Loads automatically when this panel opens.</p>
        <div id="model-progress" class="progress" hidden>
          <div class="progress-track"><div id="model-progress-fill" class="progress-fill"></div></div>
          <small id="model-progress-label"></small>
        </div>
        <button id="prewarm" type="button">Reload local model</button>
      </section>

      <section class="group">
        <h2>Diagnostics</h2>
        <label class="row">
          <span>
            <strong>Raw local diagnostics</strong>
            <small>Logs prompt text locally in DevTools and session diagnostics.</small>
          </span>
          <input id="raw-diagnostics" type="checkbox" ${debugSettings.rawDiagnosticsEnabled ? "checked" : ""} />
        </label>
        <div class="actions">
          <button id="copy-debug" type="button">Copy JSON</button>
          <button id="clear-debug" type="button">Clear</button>
          <button id="refresh-debug" type="button">Refresh</button>
        </div>
        <div id="debug-list" class="debug-list">
          ${debugRows(debugLogs.events)}
        </div>
      </section>

      <section class="group">
        <h2>Built-in domains</h2>
        <div class="list">
          ${[...BUILT_IN_HOSTS].map((host) => domainRow(host, settings)).join("")}
        </div>
      </section>

      <section class="group">
        <h2>Custom domains</h2>
        <form id="custom-form" class="form">
          <input id="custom-host" type="text" placeholder="example.com" autocomplete="off" />
          <button type="submit">Add</button>
        </form>
        <div class="list">
          ${settings.customDomains.map((host) => customDomainRow(host, settings)).join("") || `<p class="empty">No custom domains.</p>`}
        </div>
      </section>
    </section>
  `;

  bind(settings);
}

function bind(settings: PromptWardSettings): void {
  appRoot.querySelector<HTMLInputElement>("#enabled")?.addEventListener("change", async (event) => {
    await chrome.storage.sync.set({ enabled: (event.target as HTMLInputElement).checked });
    await render("Settings saved");
  });

  appRoot.querySelector<HTMLInputElement>("#webgpu")?.addEventListener("change", async (event) => {
    await chrome.storage.sync.set({ webGpuEnabled: (event.target as HTMLInputElement).checked });
    await render("Settings saved");
  });

  appRoot.querySelector<HTMLButtonElement>("#prewarm")?.addEventListener("click", async () => {
    await startPrewarm();
  });

  appRoot.querySelector<HTMLInputElement>("#raw-diagnostics")?.addEventListener("change", async (event) => {
    await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.setDebugSettings,
      rawDiagnosticsEnabled: (event.target as HTMLInputElement).checked
    });
    await render("Diagnostics saved");
  });

  appRoot.querySelector<HTMLButtonElement>("#clear-debug")?.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.clearDebugLogs });
    await render("Diagnostics cleared");
  });

  appRoot.querySelector<HTMLButtonElement>("#refresh-debug")?.addEventListener("click", async () => {
    await render("Diagnostics refreshed");
  });

  appRoot.querySelector<HTMLButtonElement>("#copy-debug")?.addEventListener("click", async () => {
    const logs = (await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.getDebugLogs })) as DebugLogsResponse;
    await navigator.clipboard.writeText(JSON.stringify(logs.events, null, 2));
    await render("Diagnostics copied");
  });

  appRoot.querySelector<HTMLFormElement>("#custom-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = appRoot.querySelector<HTMLInputElement>("#custom-host");
    const host = normalizeHost(input?.value ?? "");
    if (!host) return;
    const granted = await chrome.permissions.request({ origins: [`*://${host}/*`] });
    if (!granted) {
      await render("Permission denied");
      return;
    }
    await chrome.storage.sync.set({ customDomains: [...new Set([...settings.customDomains, host])] });
    await render("Domain added");
  });

  appRoot.querySelectorAll<HTMLInputElement>("[data-domain]").forEach((input) => {
    input.addEventListener("change", async () => {
      await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.setSiteEnabled,
        host: input.dataset.domain,
        enabled: input.checked
      });
      await render("Domain updated");
    });
  });

  appRoot.querySelectorAll<HTMLButtonElement>("[data-remove-domain]").forEach((button) => {
    button.addEventListener("click", async () => {
      const host = button.dataset.removeDomain;
      if (!host) return;
      await chrome.storage.sync.set({ customDomains: settings.customDomains.filter((item) => item !== host) });
      await chrome.permissions.remove({ origins: [`*://${host}/*`] });
      await render("Domain removed");
    });
  });
}

async function startPrewarm(): Promise<void> {
  await render("Loading model");
  setModelProgress(0, "Preparing model");
  const timer = setInterval(() => {
    void refreshDiagnosticsWhileLoading();
  }, 400);
  try {
    const response = (await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.prewarmModel })) as PrewarmModelResponse;
    await render(response.ok ? `Ready in ${response.coldStartMs ?? 0} ms` : `Model failed: ${response.error ?? "Unknown error"}`);
  } catch (error) {
    await render(`Model failed: ${error instanceof Error ? error.message : "Unknown error"}`).catch(() => undefined);
  } finally {
    clearInterval(timer);
  }
}

function setModelProgress(pct: number, label: string): void {
  const container = appRoot.querySelector<HTMLDivElement>("#model-progress");
  const fill = appRoot.querySelector<HTMLDivElement>("#model-progress-fill");
  const text = appRoot.querySelector<HTMLElement>("#model-progress-label");
  if (!container || !fill || !text) return;
  container.hidden = false;
  fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  text.textContent = label;
}

async function refreshDiagnosticsWhileLoading(): Promise<void> {
  const logs = (await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.getDebugLogs })) as DebugLogsResponse;
  const list = appRoot.querySelector<HTMLDivElement>("#debug-list");
  if (list) list.innerHTML = debugRows(logs.events);

  const overall = computeModelProgress(logs.events);
  if (overall) {
    setModelProgress(overall.pct, overall.file ? `${overall.file} — ${overall.pct}%` : `${overall.pct}%`);
  }

  const status = appRoot.querySelector<HTMLSpanElement>("#status");
  if (!status) return;
  const latest = [...logs.events].reverse().find((event) =>
    ["model-load-progress", "runtime-configured", "prewarm-start"].includes(event.stage)
  );
  if (!latest) {
    status.textContent = "Loading model";
    return;
  }
  const file = typeof latest.metadata.file === "string" ? latest.metadata.file : undefined;
  const progress = typeof latest.metadata.progress === "number" ? ` ${latest.metadata.progress}%` : "";
  status.textContent = file ? `Loading ${file}${progress}` : `Loading: ${latest.stage}`;
}

function domainRow(host: string, settings: PromptWardSettings): string {
  const enabled = settings.domainOverrides[host] ?? DEFAULT_SETTINGS.enabled;
  return `
    <label class="row compact">
      <span>${escapeHtml(host)}</span>
      <input type="checkbox" data-domain="${escapeHtml(host)}" ${enabled ? "checked" : ""} />
    </label>
  `;
}

function customDomainRow(host: string, settings: PromptWardSettings): string {
  const enabled = settings.domainOverrides[host] ?? true;
  return `
    <div class="row compact">
      <label>
        <span>${escapeHtml(host)}</span>
        <input type="checkbox" data-domain="${escapeHtml(host)}" ${enabled ? "checked" : ""} />
      </label>
      <button type="button" data-remove-domain="${escapeHtml(host)}">Remove</button>
    </div>
  `;
}

function debugRows(events: DebugLogsResponse["events"]): string {
  if (events.length === 0) return `<p class="empty">No diagnostics yet.</p>`;
  return events
    .slice(-20)
    .reverse()
    .map((event) => {
      const rawKeys = event.raw ? Object.keys(event.raw).join(", ") : "";
      return `
        <article class="debug-row">
          <div class="debug-head">
            <strong>${escapeHtml(event.context)}:${escapeHtml(event.stage)}</strong>
            <span>${new Date(event.ts ?? Date.now()).toLocaleTimeString()}</span>
          </div>
          <code>${escapeHtml(event.debugId)}</code>
          <pre>${escapeHtml(JSON.stringify(event.metadata, null, 2))}</pre>
          ${rawKeys ? `<small>raw: ${escapeHtml(rawKeys)}</small>` : ""}
        </article>
      `;
    })
    .join("");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function getAppRoot(): HTMLDivElement {
  const root = document.querySelector<HTMLDivElement>("#app");
  if (!root) throw new Error("Missing side panel root");
  return root;
}
