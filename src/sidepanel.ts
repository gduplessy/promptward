import { BUILT_IN_HOSTS, DEFAULT_SETTINGS, loadSettings, normalizeHost } from "./shared/settings";
import { MESSAGE_TYPES, type PrewarmModelResponse, type PromptWardSettings } from "./shared/messages";
import "./sidepanel.css";

const appRoot = getAppRoot();

void render();

async function render(status = "Idle"): Promise<void> {
  const settings = await loadSettings();
  appRoot.innerHTML = `
    <section class="shell">
      <header>
        <h1>PromptWard</h1>
        <span class="status">${escapeHtml(status)}</span>
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
        <button id="prewarm" type="button">Prewarm local model</button>
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
    await render("Loading model");
    const response = (await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.prewarmModel })) as PrewarmModelResponse;
    await render(response.ok ? `Ready in ${response.coldStartMs ?? 0} ms` : `Model failed: ${response.error ?? "Unknown error"}`);
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
