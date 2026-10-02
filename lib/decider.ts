/**
 * lib/decider.ts — Decider spec and model adapters ("Jev-style for any model").
 *
 * A Decider is a typed decision over a closed label set: name, kind
 * (choice | score | noul), an ordered closed label set, an instruction, and
 * optional few-shot examples. `decide()` returns one JSON document:
 * { value, probabilities, confidence, entropyBits, modelId, deciderVersion }.
 *
 * Scoring: for each label, the log-probability of its FULL token sequence
 * given the prompt (not just the first token, which breaks when labels share
 * a prefix), softmaxed over the label set; value = argmax, confidence = its
 * probability. Never renormalize a truncated vocabulary top-k.
 *
 * Adapters behind one interface, `score(prompt, labels) -> LabelScores`:
 * (1) logits models (transformers.js in the browser AND Node, same code —
 *     `createLogitsAdapter` takes loaded tokenizer/model handles, so captured
 *     runs and the live UI cannot diverge);
 * (2) local model servers with token log-probabilities (EXPERIMENTAL);
 * (3) pre-scored file importer (CSV/JSON, needs no model).
 *
 * This module is runtime-free: no top-level model imports, no window access.
 * The transformers package is loaded lazily inside `createLogitsAdapter` only
 * when no Tensor implementation is injected.
 */

export type DeciderKind = "choice" | "score" | "noul";

export interface FewShotExample {
  text: string;
  label: string;
}

export interface DeciderSpec {
  name: string;
  kind: DeciderKind;
  /** Ordered closed label set. Order is significant for score deciders. */
  labels: string[];
  instruction: string;
  fewShots?: FewShotExample[];
  version: string;
}

export interface DeciderOutput {
  value: string;
  probabilities: Record<string, number>;
  confidence: number;
  /** Full-vocabulary entropy in bits; null when the adapter cannot provide it. */
  entropyBits: number | null;
  modelId: string;
  deciderVersion: string;
  scoringNote?: string;
}

/** JSON schema for DeciderOutput (for validators and export consumers). */
export const DECIDER_OUTPUT_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "DeciderOutput",
  type: "object",
  required: ["value", "probabilities", "confidence", "entropyBits", "modelId", "deciderVersion"],
  properties: {
    value: { type: "string" },
    probabilities: {
      type: "object",
      minProperties: 1,
      additionalProperties: { type: "number", minimum: 0, maximum: 1 },
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    entropyBits: { type: ["number", "null"], minimum: 0 },
    modelId: { type: "string" },
    deciderVersion: { type: "string" },
    scoringNote: { type: "string" },
  },
} as const;

export class DeciderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeciderError";
  }
}

/**
 * The support-ticket triage decider used by `pnpm capture` and the inbox.
 * Renders byte-identical prompts to the original capture template:
 * instruction, blank line, one `Ticket: "<text>"` / `Label: <label>` pair per
 * few-shot, then the item line ending in `Label:` (no trailing space, so the
 * next token carries the label's leading space).
 */
export const TRIAGE_DECIDER: DeciderSpec = {
  name: "support-ticket-triage",
  kind: "choice",
  labels: ["refund", "review", "reject"],
  instruction:
    "You triage support tickets into exactly one label: refund, review, or reject.\nReply with only the label.",
  fewShots: [
    { text: "I was charged twice for $18, please give it back", label: "refund" },
    { text: "Where is my order? Tracking says delivered", label: "review" },
    { text: "MAKE MONEY FAST click here bit.ly/xyz win prize now", label: "reject" },
  ],
  version: "triage-v1",
};

export function buildDeciderPrompt(spec: DeciderSpec, inputText: string): string {
  const shots = (spec.fewShots ?? [])
    .map((ex) => `Ticket: ${JSON.stringify(ex.text)}\nLabel: ${ex.label}`)
    .join("\n");
  const head = shots ? `${spec.instruction}\n\n${shots}` : spec.instruction;
  return `${head}\nTicket: ${JSON.stringify(inputText)}\nLabel:`;
}

// ---------------------------------------------------------------------------
// Pure math helpers (shared by adapters and capture; unit-tested).
// ---------------------------------------------------------------------------

/** Softmax over label log-probabilities (float64, max-subtracted). */
export function softmaxOverLogProbs(labelLogProbs: number[]): number[] {
  const max = Math.max(...labelLogProbs);
  const exps = labelLogProbs.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

export function shannonBitsFromProbs(probs: number[]): number {
  let h = 0;
  for (const p of probs) {
    if (p > 0) h -= p * Math.log2(p);
  }
  return h;
}

/**
 * Find a label's token span inside a tokenized (prompt + label) sequence.
 * Throws DeciderError when the tokenizer merges across the prompt/label
 * boundary (prefix mismatch) instead of silently mis-scoring.
 */
export function labelTokenSpan(promptIds: number[], fullIds: number[]): number[] {
  if (fullIds.length <= promptIds.length) {
    throw new DeciderError(
      `label adds no tokens (prompt ${promptIds.length} ids, full ${fullIds.length} ids)`
    );
  }
  for (let i = 0; i < promptIds.length; i++) {
    if (fullIds[i] !== promptIds[i]) {
      throw new DeciderError(
        `tokenizer merges across the prompt/label boundary at id ${i}; refusing to mis-score`
      );
    }
  }
  return fullIds.slice(promptIds.length);
}

// ---------------------------------------------------------------------------
// Adapter interface.
// ---------------------------------------------------------------------------

export interface LabelScores {
  /** Per-label log P(full token sequence | prompt), same order as labels. */
  labelLogProbs: number[];
  /** Full-vocabulary entropy in bits, or null when the adapter has no access. */
  entropyBits: number | null;
  modelId: string;
}

export interface DeciderAdapter {
  readonly adapterKind: string;
  readonly modelId: string;
  score(prompt: string, labels: string[]): Promise<LabelScores>;
  /**
   * Normal text generation for the same raw input (System 2 fallback).
   * Absent on score-only adapters (pre-scored files): generate() then throws
   * and routing falls back to ESCALATE.
   */
  generate?: (input: string, opts?: GenerateOptions) => Promise<GeneratedText>;
}

/**
 * Run one Decider over one input through any adapter. Throws DeciderError on
 * malformed adapter output (wrong length, NaN, empty label set) — the kernel
 * gate then fails closed downstream.
 */
export async function decide(
  adapter: DeciderAdapter,
  spec: DeciderSpec,
  inputText: string
): Promise<DeciderOutput> {
  if (spec.labels.length === 0) throw new DeciderError("decider has an empty label set");
  const prompt = buildDeciderPrompt(spec, inputText);
  const { labelLogProbs, entropyBits, modelId } = await adapter.score(prompt, spec.labels);
  if (!Array.isArray(labelLogProbs) || labelLogProbs.length !== spec.labels.length) {
    throw new DeciderError(
      `adapter returned ${Array.isArray(labelLogProbs) ? labelLogProbs.length : "no"} scores for ${spec.labels.length} labels`
    );
  }
  for (let i = 0; i < labelLogProbs.length; i++) {
    const lp = labelLogProbs[i];
    if (typeof lp !== "number" || Number.isNaN(lp) || (lp !== -Infinity && !Number.isFinite(lp))) {
      throw new DeciderError(`adapter score for "${spec.labels[i]}" is not a log-probability: ${String(lp)}`);
    }
  }
  if (entropyBits !== null && (typeof entropyBits !== "number" || !Number.isFinite(entropyBits) || entropyBits < 0)) {
    throw new DeciderError(`adapter entropy is not a non-negative number: ${String(entropyBits)}`);
  }
  const probs = softmaxOverLogProbs(labelLogProbs);
  let sum = 0;
  for (const p of probs) sum += p;
  if (!(sum >= 0.98 && sum <= 1.02)) {
    throw new DeciderError(`decider probabilities sum to ${sum}, not 1`);
  }
  const probabilities: Record<string, number> = {};
  spec.labels.forEach((label, i) => {
    probabilities[label] = Math.round(probs[i] * 10000) / 10000;
  });
  let best = 0;
  for (let i = 1; i < probs.length; i++) {
    if (probs[i] > probs[best]) best = i;
  }
  return {
    value: spec.labels[best],
    probabilities,
    confidence: probabilities[spec.labels[best]],
    entropyBits: entropyBits === null ? null : Math.round(entropyBits * 10000) / 10000,
    modelId,
    deciderVersion: spec.version,
  };
}

// ---------------------------------------------------------------------------
// (1) Logits-model adapter: transformers.js in the browser AND Node.
// ---------------------------------------------------------------------------

/** Minimal structural surface of a transformers.js tokenizer. */
export interface TokenizerLike {
  (text: string): Promise<{ input_ids: { tolist(): unknown } }>;
  /** Decode token ids to text. Parameter is number[] so real tokenizers stay assignable. */
  decode(ids: number[]): string | Promise<string>;
}

/** Minimal structural surface of a transformers.js causal LM. */
export interface LogitsModelLike {
  forward?: (inputs: unknown) => Promise<{ logits: { tolist(): unknown } }>;
  (inputs: unknown): Promise<{ logits: { tolist(): unknown } }>;
  /** Method syntax (bivariant) so real model classes stay assignable. */
  generate?(inputs: unknown): Promise<unknown>;
}

export interface GenerateOptions {
  maxNewTokens?: number;
  temperature?: number;
}

export interface GeneratedText {
  text: string;
  modelId: string;
}

export interface LogitsAdapterHandles {
  tokenizer: TokenizerLike;
  model: LogitsModelLike;
  modelId: string;
  /**
   * Tensor constructor from the loaded runtime (browser CDN module or the npm
   * package in Node). Always required: this module never imports transformers
   * itself, so bundlers cannot pull onnxruntime-node into the browser.
   */
  TensorImpl: new (dtype: string, data: BigInt64Array, dims: number[]) => unknown;
}

function toNumberArray(nested: unknown): number[] {
  const flat = (Array.isArray(nested) ? nested : [nested]).flat(Infinity) as unknown[];
  return flat.map((x) => Number(x));
}

async function resolveTensorImpl(
  injected: LogitsAdapterHandles["TensorImpl"]
): Promise<new (dtype: string, data: BigInt64Array, dims: number[]) => unknown> {
  if (injected) return injected;
  // Deliberately no fallback import of @huggingface/transformers here: this
  // module ships to the browser, where the runtime arrives from a CDN (see
  // lib/wev-model.ts) and a bundler must never pull in onnxruntime-node.
  // Pass TensorImpl from your runtime (or use tools/capture.ts as an example).
  throw new DeciderError(
    "logits adapter needs TensorImpl from the loaded transformers runtime"
  );
}

/**
 * Score a closed label set with full-sequence log-probabilities using one
 * transformers.js causal LM. Single-token labels take a one-forward-pass fast
 * path (identical math to first-token scoring); multi-token labels accumulate
 * log P(token_i | prompt + earlier tokens), which stays correct when labels
 * share a prefix. Entropy always comes from the full-vocabulary softmax of the
 * prompt's next-token distribution.
 *
 * Pass loaded handles in: in Node, `AutoTokenizer`/`AutoModelForCausalLM`
 * from `@huggingface/transformers`; in the browser, the same objects from the
 * transformers.js runtime in `lib/wev-model.ts`. Same function, both places.
 */
export function createLogitsAdapter(handles: LogitsAdapterHandles): DeciderAdapter {
  const { tokenizer, model, modelId } = handles;

  async function forwardIds(ids: number[]): Promise<number[]> {
    const tensorImpl = await resolveTensorImpl(handles.TensorImpl);
    const big = BigInt64Array.from(ids.map((x) => BigInt(x)));
    const inputs = {
      input_ids: new tensorImpl("int64", big, [1, ids.length]),
      attention_mask: new tensorImpl("int64", BigInt64Array.from(ids.map(() => BigInt(1))), [1, ids.length]),
    };
    const outputs =
      model && typeof model.forward === "function" ? await model.forward(inputs) : await (model as (i: unknown) => Promise<{ logits: { tolist(): unknown } }>)(inputs);
    const all = (outputs.logits.tolist() as unknown[][][])[0];
    return toNumberArray(all[all.length - 1]);
  }

  function logSoftmax(logits: number[]): number[] {
    const max = Math.max(...logits);
    const shifted = logits.map((x) => x - max);
    const lse = Math.log(shifted.reduce((a, x) => a + Math.exp(x), 0));
    return shifted.map((x) => x - lse);
  }

  return {
    adapterKind: "logits-model",
    modelId,
    async score(prompt: string, labels: string[]): Promise<LabelScores> {
      const promptIds = toNumberArray(
        ((await tokenizer(prompt)).input_ids.tolist() as unknown[][])[0]
      );
      // Tokenize each label with the leading space the prompt implies
      // (prompts end in "Label:", so the continuation starts with a space).
      const spans = await Promise.all(
        labels.map(async (label) => {
          const full = toNumberArray(
            ((await tokenizer(`${prompt} ${label}`)).input_ids.tolist() as unknown[][])[0]
          );
          return labelTokenSpan(promptIds, full);
        })
      );

      const firstLogits = await forwardIds(promptIds);
      const firstProbs = (() => {
        const max = Math.max(...firstLogits);
        const exps = firstLogits.map((x) => Math.exp(x - max));
        const sum = exps.reduce((a, b) => a + b, 0);
        return exps.map((e) => e / sum);
      })();
      const entropyBits = shannonBitsFromProbs(firstProbs);

      const allSingle = spans.every((s) => s.length === 1);
      if (allSingle) {
        return { labelLogProbs: spans.map((s) => firstLogits[s[0]]), entropyBits, modelId };
      }
      const labelLogProbs: number[] = [];
      for (const span of spans) {
        let lp = 0;
        let prefix = [...promptIds];
        for (const tokenId of span) {
          const logProbs = logSoftmax(await forwardIds(prefix));
          lp += logProbs[tokenId];
          prefix = [...prefix, tokenId];
        }
        labelLogProbs.push(lp);
      }
      return { labelLogProbs, entropyBits, modelId };
    },
    /**
     * Straight-through text generation: tokenize the raw input, greedy-decode
     * past it, return only the new text. The input is never wrapped in a
     * decider prompt — byte-identical to calling the model directly.
     */
    async generate(input: string, opts?: GenerateOptions): Promise<GeneratedText> {
      if (!model.generate || typeof model.generate !== "function") {
        throw new DeciderError("logits model has no text generation available");
      }
      const encoded = await tokenizer(input);
      const inputIds = toNumberArray((encoded.input_ids.tolist() as unknown[][])[0]);
      const genInputs: Record<string, unknown> = {
        input_ids: encoded.input_ids,
        max_new_tokens: opts?.maxNewTokens ?? 64,
        do_sample: false,
      };
      if (opts?.temperature !== undefined) genInputs.temperature = opts.temperature;
      const output = (await model.generate(genInputs)) as { tolist(): unknown };
      const generatedIds = toNumberArray((output.tolist() as unknown[][])[0]);
      const newIds = generatedIds.slice(inputIds.length);
      const text = await tokenizer.decode(newIds);
      return { text, modelId };
    },
  };
}

// ---------------------------------------------------------------------------
// (2) Local model-server adapter (EXPERIMENTAL).
// ---------------------------------------------------------------------------

export interface LocalServerOptions {
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
}

type TopLogprobs =
  | Record<string, number>
  | Array<{ token: string; logprob: number }>;

function readTopLogprobs(body: unknown): TopLogprobs | null {
  const choice = (body as { choices?: Array<{ logprobs?: { top_logprobs?: unknown } }> })?.choices?.[0];
  const top = choice?.logprobs?.top_logprobs;
  if (Array.isArray(top)) {
    const arr = top[0];
    if (Array.isArray(arr)) return arr as Array<{ token: string; logprob: number }>;
    if (arr && typeof arr === "object") return arr as Record<string, number>;
    return null;
  }
  if (top && typeof top === "object") {
    const first = (top as Record<string, unknown>)[0];
    if (first !== undefined) return null;
    return top as Record<string, number>;
  }
  return null;
}

/**
 * EXPERIMENTAL: score labels through a local OpenAI-compatible server with
 * token log-probabilities (e.g. llama.cpp server). Throws a clear
 * DeciderError when the server is unreachable or blocked cross-origin, when it
 * answers without log-probs, or when the needed continuation is absent from
 * the returned top-k. No model weight is ever uploaded anywhere.
 */
export function createLocalServerAdapter(opts: LocalServerOptions): DeciderAdapter {
  const { baseUrl, model } = opts;
  const modelId = `local-server:${model}`;
  const fetchImpl = opts.fetchImpl ?? fetch;

  async function nextLogprobs(context: string, n = 20): Promise<TopLogprobs> {
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/v1/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: context, max_tokens: 1, temperature: 0, logprobs: n }),
      });
    } catch (e) {
      throw new DeciderError(
        `EXPERIMENTAL local server unreachable at ${baseUrl} (is it running? the browser may be blocking the cross-origin request): ${e instanceof Error ? e.message : String(e)}`
      );
    }
    if (!res.ok) {
      throw new DeciderError(`EXPERIMENTAL local server answered HTTP ${res.status} at ${baseUrl}`);
    }
    const top = readTopLogprobs(await res.json());
    if (!top) {
      throw new DeciderError(
        `EXPERIMENTAL local server at ${baseUrl} answered without token log-probs (needs an OpenAI-compatible /v1/completions with logprobs support, e.g. llama.cpp server; Ollama /api/generate does not expose them)`
      );
    }
    return top;
  }

  function entries(top: TopLogprobs): Array<[string, number]> {
    if (Array.isArray(top)) return top.map((e) => [e.token, e.logprob]);
    return Object.entries(top);
  }

  return {
    adapterKind: "local-server (EXPERIMENTAL)",
    modelId,
    async score(prompt: string, labels: string[]): Promise<LabelScores> {
      const labelLogProbs: number[] = [];
      for (const label of labels) {
        let remaining = ` ${label}`;
        let context = prompt;
        let lp = 0;
        while (remaining.length > 0) {
          const cands = entries(await nextLogprobs(context)).filter(
            ([token]) => token.length > 0 && remaining.startsWith(token)
          );
          if (cands.length === 0) {
            throw new DeciderError(
              `EXPERIMENTAL local server never offered the continuation for "${label}" (needed ${JSON.stringify(remaining)}); raise logprobs or use a server with full log-prob support`
            );
          }
          cands.sort((a, b) => b[0].length - a[0].length);
          const [token, logprob] = cands[0];
          if (!Number.isFinite(logprob)) {
            throw new DeciderError(`EXPERIMENTAL local server returned a non-finite logprob for ${JSON.stringify(token)}`);
          }
          lp += logprob;
          context += token;
          remaining = remaining.slice(token.length);
        }
        labelLogProbs.push(lp);
      }
      // Servers expose top-k log-probs, not the full distribution: no honest
      // full-vocabulary entropy exists here, so the gate fails closed downstream.
      return { labelLogProbs, entropyBits: null, modelId };
    },
    /**
     * Straight-through completion: the raw input goes to the server's normal
     * completion endpoint untouched (no decider prompt, no scoring wrapper).
     */
    async generate(input: string, opts?: GenerateOptions): Promise<GeneratedText> {
      let res: Response;
      try {
        res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/v1/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            prompt: input,
            max_tokens: opts?.maxNewTokens ?? 64,
            ...(opts?.temperature !== undefined ? { temperature: opts.temperature } : {}),
          }),
        });
      } catch (e) {
        throw new DeciderError(
          `EXPERIMENTAL local server unreachable at ${baseUrl}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
      if (!res.ok) {
        throw new DeciderError(`EXPERIMENTAL local server answered HTTP ${res.status} at ${baseUrl}`);
      }
      const body = (await res.json()) as { choices?: Array<{ text?: string }> };
      const text = body?.choices?.[0]?.text;
      if (typeof text !== "string") {
        throw new DeciderError(`EXPERIMENTAL local server at ${baseUrl} answered without completion text`);
      }
      return { text, modelId };
    },
  };
}

// ---------------------------------------------------------------------------
// (3) Pre-scored file importer (CSV/JSON, needs no model).
// ---------------------------------------------------------------------------

export interface PrescoredRow {
  text: string;
  gold?: string;
  probabilities: Record<string, number>;
  entropyBits?: number | null;
  scoringNote?: string;
}

function validatePrescoredRow(row: PrescoredRow, labels: string[], where: string): void {
  for (const label of labels) {
    const p = row.probabilities[label];
    if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) {
      throw new DeciderError(
        `${where}: needs a per-label probability in [0,1] for "${label}" (prob_${label} column or probabilities object)`
      );
    }
  }
  const sum = labels.reduce((a, l) => a + row.probabilities[l], 0);
  if (!(sum >= 0.98 && sum <= 1.02)) {
    throw new DeciderError(`${where}: probabilities sum to ${sum}, not 1`);
  }
  if (
    row.entropyBits !== undefined &&
    row.entropyBits !== null &&
    (typeof row.entropyBits !== "number" || !Number.isFinite(row.entropyBits) || row.entropyBits < 0)
  ) {
    throw new DeciderError(`${where}: entropyBits must be a non-negative number`);
  }
}

/** Parse pre-scored JSON: an array of {text, gold?, probabilities} or {text, gold?, predicted, confidence}. */
export function parsePrescoredJson(raw: string, labels: string[]): PrescoredRow[] {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    throw new DeciderError(`pre-scored JSON does not parse: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!Array.isArray(doc)) throw new DeciderError("pre-scored JSON must be an array of rows");
  return doc.map((item, i) => {
    const row = item as Record<string, unknown>;
    if (typeof row?.text !== "string") throw new DeciderError(`pre-scored JSON row ${i} needs a "text" string`);
    if (row.probabilities && typeof row.probabilities === "object") {
      const parsed: PrescoredRow = {
        text: row.text,
        probabilities: row.probabilities as Record<string, number>,
        entropyBits: (row.entropyBits as number | null | undefined) ?? null,
      };
      if (typeof row.gold === "string") parsed.gold = row.gold;
      validatePrescoredRow(parsed, labels, `pre-scored JSON row ${i}`);
      return parsed;
    }
    if (typeof row.predicted === "string" && typeof row.confidence === "number") {
      if (!labels.includes(row.predicted)) {
        throw new DeciderError(`pre-scored JSON row ${i}: predicted "${row.predicted}" is not in the label set`);
      }
      if (!(row.confidence >= 0 && row.confidence <= 1)) {
        throw new DeciderError(`pre-scored JSON row ${i}: confidence must be in [0,1]`);
      }
      const rest = (1 - row.confidence) / (labels.length - 1);
      const probabilities: Record<string, number> = {};
      for (const label of labels) probabilities[label] = label === row.predicted ? row.confidence : rest;
      const parsed: PrescoredRow = {
        text: row.text,
        probabilities,
        entropyBits: null,
        scoringNote: "confidence-only row: remainder spread uniformly (unverified)",
      };
      if (typeof row.gold === "string") parsed.gold = row.gold;
      validatePrescoredRow(parsed, labels, `pre-scored JSON row ${i}`);
      return parsed;
    }
    throw new DeciderError(
      `pre-scored JSON row ${i} needs per-label "probabilities" or "predicted" + "confidence"`
    );
  });
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

/** Parse pre-scored CSV with a `text` column plus `prob_<label>` columns (or `predicted` + `confidence`). */
export function parsePrescoredCsv(raw: string, labels: string[]): PrescoredRow[] {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new DeciderError("pre-scored CSV needs a header row plus at least one data row");
  const header = splitCsvLine(lines[0]);
  const textIdx = header.indexOf("text");
  if (textIdx < 0) throw new DeciderError('pre-scored CSV needs a "text" column');
  const probIdx = labels.map((l) => header.indexOf(`prob_${l}`));
  const predictedIdx = header.indexOf("predicted");
  const confidenceIdx = header.indexOf("confidence");
  const goldIdx = header.indexOf("gold");
  const entropyIdx = header.indexOf("entropyBits");
  const hasProbs = probIdx.every((i) => i >= 0);
  if (!hasProbs && !(predictedIdx >= 0 && confidenceIdx >= 0)) {
    throw new DeciderError(
      `pre-scored CSV needs ${labels.map((l) => `prob_${l}`).join(", ")} columns or predicted + confidence columns`
    );
  }
  return lines.slice(1).map((line, i) => {
    const cells = splitCsvLine(line);
    const text = cells[textIdx] ?? "";
    if (!text) throw new DeciderError(`pre-scored CSV row ${i} needs text`);
    let probabilities: Record<string, number>;
    let scoringNote: string | undefined;
    if (hasProbs) {
      probabilities = {};
      labels.forEach((label, j) => {
        probabilities[label] = Number(cells[probIdx[j]]);
      });
    } else {
      const predicted = cells[predictedIdx];
      const confidence = Number(cells[confidenceIdx]);
      if (!labels.includes(predicted)) {
        throw new DeciderError(`pre-scored CSV row ${i}: predicted "${predicted}" is not in the label set`);
      }
      if (!(confidence >= 0 && confidence <= 1)) {
        throw new DeciderError(`pre-scored CSV row ${i}: confidence must be in [0,1]`);
      }
      const rest = (1 - confidence) / (labels.length - 1);
      probabilities = {};
      for (const label of labels) probabilities[label] = label === predicted ? confidence : rest;
      scoringNote = "confidence-only row: remainder spread uniformly (unverified)";
    }
    const parsed: PrescoredRow = { text, probabilities };
    if (goldIdx >= 0 && cells[goldIdx]) parsed.gold = cells[goldIdx];
    if (entropyIdx >= 0 && cells[entropyIdx] !== "") parsed.entropyBits = Number(cells[entropyIdx]);
    if (scoringNote) parsed.scoringNote = scoringNote;
    validatePrescoredRow(parsed, labels, `pre-scored CSV row ${i}`);
    return parsed;
  });
}

/**
 * Replay pre-scored rows through the Decider interface. Prompts are rebuilt
 * with the same `buildDeciderPrompt`, so a stored row only matches the prompt
 * it was scored for; anything else throws (route to ESCALATE). Needs no model.
 */
export function createPrescoredAdapter(rows: PrescoredRow[], spec: DeciderSpec): DeciderAdapter {
  const byPrompt = new Map<string, PrescoredRow>();
  for (const row of rows) {
    validatePrescoredRow(row, spec.labels, `pre-scored row ${JSON.stringify(row.text).slice(0, 40)}`);
    byPrompt.set(buildDeciderPrompt(spec, row.text), row);
  }
  return {
    adapterKind: "prescored-file",
    modelId: "prescored-file",
    async score(prompt: string, labels: string[]): Promise<LabelScores> {
      if (labels.length !== spec.labels.length || labels.some((l, i) => l !== spec.labels[i])) {
        throw new DeciderError("pre-scored adapter was built for a different label set");
      }
      const row = byPrompt.get(prompt);
      if (!row) {
        throw new DeciderError("no pre-scored row matches this prompt; escalate instead of guessing");
      }
      return {
        labelLogProbs: spec.labels.map((l) => Math.log(row.probabilities[l])),
        entropyBits: row.entropyBits ?? null,
        modelId: "prescored-file",
      };
    },
  };
}

// ---------------------------------------------------------------------------
// User-supplied labelled items (app/calibrate): raw text + gold label, no
// scores yet. The browser scores them with the same adapters above.
// ---------------------------------------------------------------------------

export interface LabelledItem {
  text: string;
  gold: string;
}

function readLabelledRow(row: Record<string, unknown>, labels: string[], where: string): LabelledItem {
  const text = row.text;
  const gold = (row.label ?? row.gold) as unknown;
  if (typeof text !== "string" || !text.trim()) {
    throw new DeciderError(`${where} needs a non-empty "text" string`);
  }
  if (typeof gold !== "string" || !labels.includes(gold)) {
    throw new DeciderError(
      `${where} needs a label in [${labels.join(", ")}], got ${JSON.stringify(gold)}`
    );
  }
  return { text, gold };
}

/** Parse user items from JSON: an array of {text, label} (or {text, gold}). */
export function parseLabelledItemsJson(raw: string, labels: string[]): LabelledItem[] {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    throw new DeciderError(`labelled JSON does not parse: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!Array.isArray(doc)) throw new DeciderError("labelled JSON must be an array of {text, label} rows");
  return doc.map((item, i) => readLabelledRow(item as Record<string, unknown>, labels, `row ${i}`));
}

/** Parse user items from CSV with `text` + `label` (or `gold`) columns. */
export function parseLabelledItemsCsv(raw: string, labels: string[]): LabelledItem[] {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new DeciderError("labelled CSV needs a header row plus at least one data row");
  const header = splitCsvLine(lines[0]);
  const textIdx = header.indexOf("text");
  let labelIdx = header.indexOf("label");
  if (labelIdx < 0) labelIdx = header.indexOf("gold");
  if (textIdx < 0 || labelIdx < 0) {
    throw new DeciderError('labelled CSV needs "text" and "label" columns');
  }
  return lines.slice(1).map((line, i) => {
    const cells = splitCsvLine(line);
    return readLabelledRow({ text: cells[textIdx] ?? "", label: cells[labelIdx] ?? "" }, labels, `row ${i}`);
  });
}
