export const APP_VERSION = "0.9.0";
export const DEBUG_LOG_LIMIT = 100;

export type DebugSettings = {
  rawDiagnosticsEnabled: boolean;
};

export const DEFAULT_DEBUG_SETTINGS: DebugSettings = {
  rawDiagnosticsEnabled: false
};

export type DebugContext = "content" | "background" | "offscreen" | "worker" | "sidepanel";
export type DebugLevel = "debug" | "info" | "warn" | "error";

export type DebugEvent = {
  id: string;
  debugId: string;
  ts: number;
  context: DebugContext;
  stage: string;
  level: DebugLevel;
  version: string;
  url?: string;
  metadata: Record<string, unknown>;
  raw?: Record<string, string>;
};

export type DebugLogInput = Omit<DebugEvent, "id" | "ts" | "version"> & {
  id?: string;
  ts?: number;
  version?: string;
};

export async function hashText(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

export async function textSummary(text: string): Promise<Record<string, unknown>> {
  return {
    textLength: text.length,
    textHash: await hashText(text),
    hasText: text.length > 0
  };
}

export function normalizeDebugEvent(input: DebugLogInput): DebugEvent {
  return {
    id: input.id ?? crypto.randomUUID(),
    debugId: input.debugId,
    ts: input.ts ?? Date.now(),
    context: input.context,
    stage: input.stage,
    level: input.level,
    version: input.version ?? APP_VERSION,
    url: input.url,
    metadata: input.metadata,
    raw: input.raw
  };
}
