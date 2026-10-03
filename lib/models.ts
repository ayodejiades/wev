/**
 * lib/models.ts — Model registry, download-size lookup, and per-model
 * thresholds for the picker (Step 9).
 *
 * Preset rule (enforced by the UI, stated here): a preset stays listed only
 * while it loads. SmolLM2-135M backs all committed evidence and the live
 * surfaces. SmolLM2-360M weights were loaded and scored off-device this
 * session (3/3 items through the shared decider); its first browser load
 * happens on select, and a failed preset is delisted, never retried silently.
 *
 * Threshold rule: stored device thresholds win for their model id, committed
 * evidence thresholds are the fallback for their own model id only, and
 * anything else calibrates first — one model's thresholds are never reused
 * for another model.
 */

export interface ModelPreset {
  id: string;
  dtype: string;
  short: string;
  status: "verified" | "weights-verified";
  note: string;
}

export const MODEL_PRESETS: ModelPreset[] = [
  {
    id: "onnx-community/SmolLM2-135M-ONNX",
    dtype: "uint8",
    short: "SmolLM2 135M",
    status: "verified",
    note: "Backs all committed evidence; runs on /live, /inbox, /proof.",
  },
  {
    id: "onnx-community/SmolLM2-360M-ONNX",
    dtype: "uint8",
    short: "SmolLM2 360M",
    status: "weights-verified",
    note: "Weights loaded and scored off-device; browser load runs on first select.",
  },
];

export interface ThresholdSet {
  autoConfidence: number;
  maxEntropyBits: number;
}

export type ThresholdSource = "stored" | "committed" | "none";

function validThresholds(t: unknown): t is ThresholdSet {
  if (typeof t !== "object" || t === null) return false;
  const { autoConfidence, maxEntropyBits } = t as Record<string, unknown>;
  return (
    typeof autoConfidence === "number" &&
    Number.isFinite(autoConfidence) &&
    autoConfidence >= 0 &&
    autoConfidence <= 1 &&
    typeof maxEntropyBits === "number" &&
    Number.isFinite(maxEntropyBits) &&
    maxEntropyBits >= 0
  );
}

/**
 * Resolve thresholds for one model id: device-stored first, committed evidence
 * only when it names the same model, otherwise none (caller must calibrate).
 */
export function resolveModelThresholds(
  modelId: string,
  committed: { modelId: string; autoConfidence: number; maxEntropyBits: number },
  stored: Record<string, unknown>
): { thresholds: ThresholdSet | null; source: ThresholdSource } {
  const own = stored[modelId];
  if (validThresholds(own)) {
    return {
      thresholds: { autoConfidence: own.autoConfidence, maxEntropyBits: own.maxEntropyBits },
      source: "stored",
    };
  }
  if (committed.modelId === modelId && validThresholds(committed)) {
    return {
      thresholds: { autoConfidence: committed.autoConfidence, maxEntropyBits: committed.maxEntropyBits },
      source: "committed",
    };
  }
  return { thresholds: null, source: "none" };
}

const storageKey = (modelId: string) => `wev.thresholds.${modelId}`;

/** Device thresholds keyed by model id. No-ops outside the browser. */
export function loadStoredThresholds(): Record<string, ThresholdSet & { calibratedAt?: string; items?: number }> {
  if (typeof window === "undefined" || !window.localStorage) return {};
  try {
    const out: Record<string, ThresholdSet & { calibratedAt?: string; items?: number }> = {};
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith("wev.thresholds.")) continue;
      const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "null");
      if (validThresholds(parsed)) out[key.slice("wev.thresholds.".length)] = parsed as ThresholdSet;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveThresholdsForModel(
  modelId: string,
  thresholds: ThresholdSet,
  meta?: { calibratedAt?: string; items?: number }
): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(storageKey(modelId), JSON.stringify({ ...thresholds, ...meta }));
  } catch {
    // Quota or privacy mode: thresholds simply do not persist.
  }
}

// ---------------------------------------------------------------------------
// Download size before loading (Hugging Face API + HEAD requests).
// ---------------------------------------------------------------------------

/** Weight + tokenizer files backing one dtype choice. */
export function dtypeArtifactFiles(dtype: string): string[] {
  return [
    `onnx/model_${dtype}.onnx`,
    `onnx/model_${dtype}.onnx_data`,
    "tokenizer.json",
    "config.json",
    "tokenizer_config.json",
  ];
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "size unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

export interface SizeResult {
  bytes: number;
  text: string;
  partial: boolean;
}

/**
 * Sum content-lengths for the dtype artifacts (404s skipped: not every dtype
 * ships a split .onnx_data file). Partial when any probe fails, so the UI
 * never understates a download.
 */
export async function fetchModelSize(
  modelId: string,
  dtype: string,
  fetchImpl: typeof fetch = fetch
): Promise<SizeResult> {
  let bytes = 0;
  let partial = false;
  for (const file of dtypeArtifactFiles(dtype)) {
    try {
      const res = await fetchImpl(`https://huggingface.co/${modelId}/resolve/main/${file}`, { method: "HEAD" });
      if (res.status === 404) continue;
      if (!res.ok) {
        partial = true;
        continue;
      }
      const len = Number(res.headers.get("content-length"));
      if (!Number.isFinite(len) || len < 0) {
        partial = true;
        continue;
      }
      bytes += len;
    } catch {
      partial = true;
    }
  }
  return { bytes, text: bytes > 0 ? `~${formatBytes(bytes)} download` : "size unknown", partial };
}

/** Map a load failure to a plain explanation (never a hang, never a stack). */
export function explainLoadError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/out of memory|allocation failed|OOM/i.test(message)) {
    return `Device ran out of memory loading the weights. Close tabs or pick a smaller model. (${message})`;
  }
  if (/timed out|timeout|aborted|abort/i.test(message)) {
    return `Load timed out or was stopped. Check the connection and retry. (${message})`;
  }
  // transformers.js v3 says "Could not locate file" for a 404/ENOENT; without
  // this the user got a raw module message instead of the plain explanation.
  if (/404|not found|no such|revision|could not locate/i.test(message)) {
    return `Model id not found on the Hub, or it has no ONNX weights this app can load. (${message})`;
  }
  if (/failed to fetch|fetch failed|network|CORS|cross-origin|load failed/i.test(message)) {
    return `Network or cross-origin block while fetching weights. The CDN/API must be reachable. (${message})`;
  }
  return `Model failed to load: ${message}`;
}
