import type { DebugLogInput } from "./debug";

export type ModelProgress = {
  pct: number;
  file?: string;
};

/**
 * Aggregates worker model-load-progress events into one overall percentage.
 * Events are per file; overall progress is byte-weighted across the latest
 * snapshot of every file seen, so the 14.7 MB ONNX file dominates as it should.
 */
export function computeModelProgress(events: readonly DebugLogInput[]): ModelProgress | undefined {
  const latestByFile = new Map<string, { loaded: number; total: number }>();
  let currentFile: string | undefined;

  for (const event of events) {
    if (event.stage !== "model-load-progress") continue;
    const file = typeof event.metadata.file === "string" ? event.metadata.file : undefined;
    if (!file) continue;
    currentFile = file;

    const loaded = typeof event.metadata.loaded === "number" ? event.metadata.loaded : undefined;
    const total = typeof event.metadata.total === "number" ? event.metadata.total : undefined;
    if (loaded !== undefined && total !== undefined && total > 0) {
      latestByFile.set(file, { loaded: Math.min(loaded, total), total });
    } else if (event.metadata.status === "done") {
      const known = latestByFile.get(file);
      if (known) latestByFile.set(file, { loaded: known.total, total: known.total });
    }
  }

  if (latestByFile.size === 0) return undefined;

  let loadedSum = 0;
  let totalSum = 0;
  for (const { loaded, total } of latestByFile.values()) {
    loadedSum += loaded;
    totalSum += total;
  }
  return {
    pct: Math.min(100, Math.round((loadedSum / totalSum) * 100)),
    file: currentFile
  };
}
