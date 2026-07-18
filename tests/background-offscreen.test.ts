import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("background: offscreen document creation race", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  function sendMessageAndCollect(
    listeners: { onMessage?: Function },
    message: Record<string, unknown>
  ): Promise<unknown> {
    return new Promise((resolve) => {
      const keepAlive = listeners.onMessage?.(message, {}, resolve);
      expect(keepAlive).toBe(true);
    });
  }

  it("serializes concurrent offscreen-document creation into a single createDocument call", async () => {
    const listeners: { onMessage?: Function } = {};
    let created = false;
    const createDocument = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      created = true;
    });
    const getContexts = vi.fn(async () => (created ? [{}] : []));

    vi.stubGlobal("chrome", {
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
        onMessage: { addListener: vi.fn((fn: Function) => { listeners.onMessage = fn; }) },
        getContexts,
        getURL: (p: string) => `chrome-extension://test/${p}`,
        sendMessage: vi.fn(async () => ({ ok: true })),
        ContextType: { OFFSCREEN_DOCUMENT: "OFFSCREEN_DOCUMENT" }
      },
      offscreen: { createDocument, Reason: { WORKERS: "WORKERS" } },
      storage: {
        onChanged: { addListener: vi.fn() },
        sync: { get: vi.fn(async (defaults: unknown) => defaults), set: vi.fn(async () => undefined) },
        local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) },
        session: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) }
      },
      tabs: { onRemoved: { addListener: vi.fn() }, onUpdated: { addListener: vi.fn() } },
      sidePanel: { setPanelBehavior: vi.fn(async () => undefined) },
      scripting: {
        registerContentScripts: vi.fn(async () => undefined),
        unregisterContentScripts: vi.fn(async () => undefined)
      }
    } as unknown as typeof chrome);

    await import("../src/background");

    const [response1, response2] = await Promise.all([
      sendMessageAndCollect(listeners, { type: "PW_PREWARM_MODEL" }),
      sendMessageAndCollect(listeners, { type: "PW_PREWARM_MODEL" })
    ]);

    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(response1).toEqual({ ok: true });
    expect(response2).toEqual({ ok: true });
  });

  it("does not call createDocument again for a message sent after creation already resolved", async () => {
    const listeners: { onMessage?: Function } = {};
    let created = false;
    const createDocument = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      created = true;
    });
    const getContexts = vi.fn(async () => (created ? [{}] : []));

    vi.stubGlobal("chrome", {
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
        onMessage: { addListener: vi.fn((fn: Function) => { listeners.onMessage = fn; }) },
        getContexts,
        getURL: (p: string) => `chrome-extension://test/${p}`,
        sendMessage: vi.fn(async () => ({ ok: true })),
        ContextType: { OFFSCREEN_DOCUMENT: "OFFSCREEN_DOCUMENT" }
      },
      offscreen: { createDocument, Reason: { WORKERS: "WORKERS" } },
      storage: {
        onChanged: { addListener: vi.fn() },
        sync: { get: vi.fn(async (defaults: unknown) => defaults), set: vi.fn(async () => undefined) },
        local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) },
        session: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) }
      },
      tabs: { onRemoved: { addListener: vi.fn() }, onUpdated: { addListener: vi.fn() } },
      sidePanel: { setPanelBehavior: vi.fn(async () => undefined) },
      scripting: {
        registerContentScripts: vi.fn(async () => undefined),
        unregisterContentScripts: vi.fn(async () => undefined)
      }
    } as unknown as typeof chrome);

    await import("../src/background");

    await sendMessageAndCollect(listeners, { type: "PW_PREWARM_MODEL" });
    expect(createDocument).toHaveBeenCalledTimes(1);

    const response = await sendMessageAndCollect(listeners, { type: "PW_PREWARM_MODEL" });
    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(response).toEqual({ ok: true });
  });

  it("tolerates the already-exists error from a concurrent create", async () => {
    const listeners: { onMessage?: Function } = {};
    let createCallCount = 0;
    const createDocument = vi.fn(async () => {
      createCallCount += 1;
      if (createCallCount === 1) {
        throw new Error("Only a single offscreen document may be created.");
      }
    });
    const getContexts = vi.fn(async () => []);

    vi.stubGlobal("chrome", {
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
        onMessage: { addListener: vi.fn((fn: Function) => { listeners.onMessage = fn; }) },
        getContexts,
        getURL: (p: string) => `chrome-extension://test/${p}`,
        sendMessage: vi.fn(async () => ({ ok: true })),
        ContextType: { OFFSCREEN_DOCUMENT: "OFFSCREEN_DOCUMENT" }
      },
      offscreen: { createDocument, Reason: { WORKERS: "WORKERS" } },
      storage: {
        onChanged: { addListener: vi.fn() },
        sync: { get: vi.fn(async (defaults: unknown) => defaults), set: vi.fn(async () => undefined) },
        local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) },
        session: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) }
      },
      tabs: { onRemoved: { addListener: vi.fn() }, onUpdated: { addListener: vi.fn() } },
      sidePanel: { setPanelBehavior: vi.fn(async () => undefined) },
      scripting: {
        registerContentScripts: vi.fn(async () => undefined),
        unregisterContentScripts: vi.fn(async () => undefined)
      }
    } as unknown as typeof chrome);

    await import("../src/background");

    const response = await sendMessageAndCollect(listeners, { type: "PW_PREWARM_MODEL" });
    expect(response).toEqual({ ok: true });
  });
});
