/**
 * lib/wev-model.ts — in-browser tiny-model inference (transformers.js, client only).
 *
 * Loads onnx-community/SmolLM2-135M-ONNX (SmolLM2, 135M params, 2025 — a
 * far stronger base than 2019-era distilgpt2, still CPU-runnable, ~130MB uint8)
 * then scores the next-token distribution for a prompt: top-k tokens with exact
 * probabilities from the model's own logits. Everything runs on the device; the
 * only network use is the first weight download, cached by the browser after.
 *
 * The transformers.js runtime is NOT bundled (npm registry was unreachable at
 * build time). It loads at runtime from the jsDelivr CDN as a UMD script and is
 * cached like any other static asset. No build, no server, no key.
 *
 * Honesty note: the kernel's validity gate (INV-1) needs probabilities summing
 * to 1, but a truncated top-k never does — so `renormalizeTopK` rescales the
 * top-k to sum to exactly 1 and the UI labels it as renormalized, alongside the
 * raw top-k sum and the full-vocabulary entropy.
 */

import { createLogitsAdapter, type DeciderAdapter } from "@/lib/decider";
import {
  createLocalServerAdapter,
  createPrescoredAdapter,
  parsePrescoredCsv,
  parsePrescoredJson,
  type DeciderSpec,
  type PrescoredRow,
} from "@/lib/decider";
import {
  buildInventory,
  createFolderCache,
  validateFolder,
  type DroppedFile,
  type FolderFile,
} from "@/lib/local-folder";

// ---------------------------------------------------------------------------
// Adapter choice: "any local model" means one of three concrete things, never a
// vague promise. Each adapter carries its own model id, and device thresholds
// live under `wev.thresholds.<modelId>` — never shared across adapters, so a
// local server's bar can never be inherited from the in-browser model.
// ---------------------------------------------------------------------------

export type AdapterChoice =
  | { kind: "server"; baseUrl: string; model: string; fetchImpl?: typeof fetch }
  | { kind: "prescored"; fileName: string; raw: string };

/** Default local server endpoint (llama.cpp server style). EXPERIMENTAL. */
export const LOCAL_SERVER_DEFAULT_URL = "http://localhost:8080/v1";

/** Parse a pre-scored CSV/JSON file body into rows (by extension, then content). */
export function parsePrescoredFile(
  fileName: string,
  raw: string,
  spec: DeciderSpec
): PrescoredRow[] {
  const looksJson = /\.json$/i.test(fileName) || raw.trimStart().startsWith("[");
  return looksJson ? parsePrescoredJson(raw, spec.labels) : parsePrescoredCsv(raw, spec.labels);
}

/**
 * Build the chosen non-ONNX adapter, reusing lib/decider.ts implementations —
 * nothing is reimplemented here. A score-only adapter (pre-scored file) has no
 * generate(), so `jevify` routes every non-AUTO item to ESCALATE instead of
 * inventing text. Model ids: `server:<model>` and `prescored:<filename>`.
 *
 * The in-browser ONNX adapters are built by loadTriageAdapter /
 * loadTriageAdapterFromFolder above, which need a browser runtime.
 */
export function createAdapterFromChoice(choice: AdapterChoice, spec: DeciderSpec): DeciderAdapter {
  if (choice.kind === "server") {
    const base = createLocalServerAdapter({
      baseUrl: choice.baseUrl,
      model: choice.model,
      ...(choice.fetchImpl ? { fetchImpl: choice.fetchImpl } : {}),
    });
    return {
      adapterKind: base.adapterKind,
      modelId: `server:${choice.model}`,
      score: (prompt, labels) => base.score(prompt, labels),
      generate: (input, opts) => base.generate!(input, opts),
    };
  }
  const inner = createPrescoredAdapter(parsePrescoredFile(choice.fileName, choice.raw, spec), spec);
  return {
    adapterKind: inner.adapterKind,
    modelId: `prescored:${choice.fileName}`,
    score: (prompt, labels) => inner.score(prompt, labels),
  };
}

export interface LiveCandidate {
  token: string;
  prob: number;
}
export interface LiveResult {
  prompt: string;
  generated: string;
  /** Top-k candidates RENORMALIZED to sum to 1 — the kernel-ready distribution. */
  candidates: LiveCandidate[];
  /** Raw top-k probabilities straight from the softmax, before renormalization. */
  rawCandidates: LiveCandidate[];
  /** Sum of the raw top-k probabilities (always < 1 for k << vocab size). */
  rawTopProbSum: number;
  /** Shannon entropy over the FULL vocabulary distribution (the honest uncertainty). */
  fullVocabEntropyBits: number;
  renormalized: true;
  modelId: string;
  dtype: string;
}

export interface TriageHandles {
  // Kept as `any` (like the historical cache): the inspector below needs the
  // full runtime surface (dims, batch_decode), while the triage adapter only
  // needs the narrow TokenizerLike/LogitsModelLike subset it is cast to.
  tokenizer: any;
  model: any;
  modelId: string;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

interface CachedHandles {
  tokenizer: any;
  model: any;
}

/**
 * Load the shared model handles (tokenizer + weights, cached per model id).
 * Used by both the next-token inspector below and the triage adapter, so the
 * inbox scores through the identical weights.
 */
export async function loadTriageHandles(
  onProgress?: (pct: number, label: string) => void,
  opts?: { modelId?: string; dtype?: string; timeoutMs?: number },
): Promise<TriageHandles> {
  const modelId = opts?.modelId ?? MODEL_ID;
  const dtype = opts?.dtype ?? DTYPE;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const key = `${modelId}:${dtype}`;
  const holder = window as unknown as { __wevModels?: Record<string, CachedHandles> };
  if (!holder.__wevModels) holder.__wevModels = {};
  const cached = holder.__wevModels[key];
  if (cached) return { tokenizer: cached.tokenizer, model: cached.model, modelId };

  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const load = (async () => {
      const T = await loadRuntime();
      T.env.allowLocalModels = false;
      onProgress?.(2, "tokenizer");
      const tokenizer = await T.AutoTokenizer.from_pretrained(modelId);
      onProgress?.(8, `weights (${modelId}, once)`);
      const model = await T.AutoModelForCausalLM.from_pretrained(modelId, {
        dtype,
        device: DEVICE,
        progress_callback: (info: any) => {
          if (info && typeof info.progress === "number") {
            onProgress?.(8 + Math.round(info.progress * 0.85), info.file ?? "weights");
          }
        },
      });
      return { tokenizer, model };
    })();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `model load timed out after ${Math.round(timeoutMs / 60000)} min (${modelId}); check the connection and retry`
            )
          ),
        timeoutMs
      );
    });
    const { tokenizer, model } = await Promise.race([load, timeout]);
    holder.__wevModels[key] = { tokenizer, model };
    return { tokenizer, model, modelId };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The closed-label triage adapter over the in-browser model: the same
 * `createLogitsAdapter` scoring `pnpm capture` uses in Node, so live items and
 * captured runs cannot diverge. Needs the transformer's Tensor constructor
 * from the loaded CDN runtime (never the npm package — see lib/decider.ts).
 */
export async function loadTriageAdapter(
  onProgress?: (pct: number, label: string) => void,
  opts?: { modelId?: string; dtype?: string; timeoutMs?: number },
): Promise<DeciderAdapter> {
  const { tokenizer, model, modelId } = await loadTriageHandles(onProgress, opts);
  const T = await loadRuntime();
  type TensorCtor = new (dtype: string, data: BigInt64Array, dims: number[]) => unknown;
  const TensorImpl = (T as unknown as { Tensor?: TensorCtor }).Tensor;
  if (!TensorImpl) throw new Error("transformers.js runtime has no Tensor export; cannot build the triage adapter");
  return createLogitsAdapter({ tokenizer, model, modelId, TensorImpl });
}

export interface DroppedFolder {
  name: string;
  files: FolderFile[];
}

/**
 * EXPERIMENTAL: triage adapter over a user-dropped local folder. The folder's
 * bytes are served to transformers.js through a custom cache with
 * local_files_only, so from_pretrained resolves locally with no upload to any
 * server. Throws LocalFolderError naming exactly what is missing.
 */
export async function loadTriageAdapterFromFolder(
  dropped: DroppedFile[],
  folderName: string,
  onProgress?: (pct: number, label: string) => void,
): Promise<{ adapter: DeciderAdapter; modelId: string; summary: string }> {
  const inventory = buildInventory(
    dropped.map((f) => ({
      path: f.webkitRelativePath || f.name,
      size: f.size,
      arrayBuffer: () => f.arrayBuffer(),
    }))
  );
  const validation = validateFolder(inventory);
  const cache = createFolderCache(inventory);
  const T = await loadRuntime();
  type TensorCtor = new (dtype: string, data: BigInt64Array, dims: number[]) => unknown;
  const TensorImpl = (T as unknown as { Tensor?: TensorCtor }).Tensor;
  if (!TensorImpl) throw new Error("transformers.js runtime has no Tensor export; cannot build the triage adapter");

  const VIRTUAL_ID = "local-folder";
  const prevAllowLocal = T.env.allowLocalModels;
  const prevUseCustom = T.env.useCustomCache;
  const prevCustom = T.env.customCache;
  const localOpts = { local_files_only: true } as Record<string, unknown>;
  try {
    T.env.allowLocalModels = true;
    T.env.useCustomCache = true;
    T.env.customCache = cache;
    onProgress?.(2, "local tokenizer");
    const tokenizer = await T.AutoTokenizer.from_pretrained(VIRTUAL_ID, {
      ...localOpts,
      progress_callback: (info: any) => {
        if (info && typeof info.progress === "number") onProgress?.(2 + Math.round(info.progress * 0.2), info.file ?? "tokenizer");
      },
    });
    onProgress?.(25, `local weights (${validation.weightsFile})`);
    const model = await T.AutoModelForCausalLM.from_pretrained(VIRTUAL_ID, {
      ...localOpts,
      dtype: validation.dtype,
      device: DEVICE,
      progress_callback: (info: any) => {
        if (info && typeof info.progress === "number") {
          onProgress?.(25 + Math.round(info.progress * 0.7), info.file ?? "weights");
        }
      },
    });
    const modelId = `local-folder:${folderName}`;
    return {
      adapter: createLogitsAdapter({ tokenizer, model, modelId, TensorImpl }),
      modelId,
      summary: `${validation.weightsFile} (${validation.dtype}), ${validation.folderFiles.length} files, no upload`,
    };
  } finally {
    T.env.allowLocalModels = prevAllowLocal;
    T.env.useCustomCache = prevUseCustom;
    T.env.customCache = prevCustom;
  }
}

// v3 ships ESM only (no UMD global), so import the pre-bundled +esm file at
// runtime. The URL is assembled (not a literal) so the bundler leaves it alone
// and the browser fetches it natively, cached like any static asset.
const ESM_URL =
  "https://cdn.jsdelivr.net/npm/" + "@huggingface/transformers@3.8.1/+esm";
const MODEL_ID = "onnx-community/SmolLM2-135M-ONNX";
// uint8: the repo ships model_uint8.onnx (no q8 file — q8 would silently fall
// back to the 1.7GB fp32). Runs on plain WASM CPU, no GPU needed.
const DTYPE = "uint8";
const DEVICE = "wasm";

// Minimal structural typing for the runtime (the npm package is not installed;
// the real implementation loads from CDN at runtime in the browser).
export interface TransformersNS {
  env: {
    allowLocalModels: boolean;
    allowRemoteModels?: boolean;
    useCustomCache?: boolean;
    customCache?: unknown;
  };
  AutoTokenizer: { from_pretrained(id: string, opts?: Record<string, unknown>): Promise<any> };
  AutoModelForCausalLM: { from_pretrained(id: string, opts?: Record<string, unknown>): Promise<any> };
}

declare global {
  interface Window {
    transformers?: TransformersNS;
  }
}

let scriptPromise: Promise<TransformersNS> | null = null;

function loadRuntime(): Promise<TransformersNS> {
  if (typeof window === "undefined") return Promise.reject(new Error("browser only"));
  if (window.transformers) return Promise.resolve(window.transformers);
  if (!scriptPromise) {
    // webpackIgnore keeps the bundler from resolving the CDN URL at build time;
    // the browser fetches it natively at runtime instead.
    scriptPromise = import(/* webpackIgnore: true */ ESM_URL).then((mod) => {
      const ns = (mod?.default ?? mod) as TransformersNS;
      if (!ns?.AutoTokenizer || !ns?.AutoModelForCausalLM) {
        throw new Error("transformers.js runtime loaded but has no model API");
      }
      window.transformers = ns;
      return ns;
    });
    scriptPromise.catch(() => {
      scriptPromise = null;
    });
  }
  return scriptPromise;
}

export function modelStatus(): "unloaded" | "loading" | "ready" {
  if (typeof window !== "undefined") {
    const store = (window as unknown as { __wevModels?: Record<string, unknown> }).__wevModels;
    if (store && Object.keys(store).length > 0) return "ready";
  }
  return scriptPromise ? "loading" : "unloaded";
}

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

function shannonBits(probs: number[]): number {
  let h = 0;
  for (const p of probs) {
    if (p > 0) h -= p * Math.log2(p);
  }
  return Math.round(h * 10000) / 10000;
}

/**
 * Renormalize raw top-k probabilities into a valid kernel distribution.
 *
 * Pure function (no browser needed) so it is unit-tested in
 * tests/health.test.mjs. A truncated top-k never sums to 1, and INV-1 would
 * refuse every live result; renormalizing is the standard, disclosed fix:
 * divide by the raw sum, round to 4dp, then fold the rounding drift into the
 * leader so the output sums to exactly 1.0 and stays sorted descending.
 */
export function renormalizeTopK(raw: LiveCandidate[]): LiveCandidate[] {
  const sum = raw.reduce((a, c) => a + c.prob, 0);
  if (!Number.isFinite(sum) || sum <= 0) throw new Error("empty distribution");
  const scaled = raw.map((c) => ({ token: c.token, prob: c.prob / sum }));
  scaled.sort((a, b) => b.prob - a.prob);
  const rounded = scaled.map((c) => ({ token: c.token, prob: Math.round(c.prob * 10000) / 10000 }));
  const drift = Math.round((1 - rounded.reduce((a, c) => a + c.prob, 0)) * 10000) / 10000;
  rounded[0].prob = Math.round((rounded[0].prob + drift) * 10000) / 10000;
  return rounded;
}

/**
 * Score the next-token distribution for `prompt`. Returns the top-k decoded
 * tokens with probabilities from the model's own output logits, plus one greedy
 * continuation token for display.
 */
export async function scoreNextToken(
  prompt: string,
  topK = 5,
  onProgress?: (pct: number, label: string) => void,
): Promise<LiveResult> {
  if (!prompt.trim()) throw new Error("Type a prompt first. The model needs words to continue.");
  const { tokenizer, model } = await loadTriageHandles(onProgress);

  const inputs = await tokenizer(prompt);
  onProgress?.(96, "scoring");
  // One forward pass is all the inspector needs: the last position's logits are the
  // model's own next-token distribution. (generate() in v3 does not expose
  // per-step scores, so the loop is skipped deliberately — not a shortcut.)
  // PreTrainedModel instances are callable in transformers.js; .forward is the
  // same path — try it first, fall back to calling the model directly.
  const outputs =
    model && typeof model.forward === "function" ? await model.forward(inputs) : await model(inputs);
  const { logits } = outputs;
  const seqLen = logits.dims[1];
  const lastLogits = (logits.tolist() as number[][][])[0][seqLen - 1] as number[];
  const probs = softmax(lastLogits);
  const fullVocabEntropyBits = shannonBits(probs);
  const ranked = probs
    .map((prob, id) => ({ id, prob }))
    .sort((a, b) => b.prob - a.prob)
    .slice(0, topK);

  const ids = ranked.map((r) => r.id);
  // batch_decode expects one id-SEQUENCE per item, so wrap each top id as [id].
  // Passing the flat [id1, id2, …] array makes it treat each int as a sequence
  // and throw "token_ids must be a non-empty array of integers."
  const tokens = (await tokenizer.batch_decode(
    ids.map((id) => [id]),
    { skip_special_tokens: false },
  )) as string[];

  const rawCandidates: LiveCandidate[] = ranked.map((r, i) => ({
    token: tokens[i],
    prob: Math.round(r.prob * 10000) / 10000,
  }));
  const rawTopProbSum = Math.round(ranked.reduce((a, r) => a + r.prob, 0) * 10000) / 10000;
  // The kernel's validity gate (INV-1) needs probabilities that sum to 1; a
  // truncated top-k never does, so renormalize and say so on screen.
  const candidates = renormalizeTopK(rawCandidates);

  onProgress?.(100, "done");
  return {
    prompt,
    generated: tokens[0],
    candidates,
    rawCandidates,
    rawTopProbSum,
    fullVocabEntropyBits,
    renormalized: true,
    modelId: MODEL_ID,
    dtype: DTYPE,
  };
}
