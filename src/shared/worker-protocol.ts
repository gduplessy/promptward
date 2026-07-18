import type { PlaceholderSummary } from "./messages";

export type WorkerRequest =
  | {
      id: string;
      type: "protect";
      text: string;
      conversationKey: string;
      modelBaseUrl: string;
      ortBaseUrl: string;
      debugId?: string;
      rawDiagnosticsEnabled: boolean;
    }
  | { id: string; type: "reveal"; text: string; conversationKey: string }
  | { id: string; type: "prewarm"; modelBaseUrl: string; ortBaseUrl: string; debugId?: string; rawDiagnosticsEnabled: boolean }
  | { id: string; type: "reset"; conversationKey: string };

export type WorkerResponse =
  | { id: string; ok: true; status: "ready" | "loading"; coldStartMs?: number }
  | {
      id: string;
      ok: true;
      safeText: string;
      changed: boolean;
      placeholders: PlaceholderSummary[];
      durationMs: number;
    }
  | { id: string; ok: true; text: string }
  | { id: string; ok: true }
  | { id: string; ok: false; error: string; status?: "error" };
