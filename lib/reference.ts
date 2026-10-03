/**
 * lib/reference.ts — OPTIONAL reference-model labeller ("web model as evidence").
 *
 * A reference model is a hosted model reached over an OpenAI-compatible
 * `/v1/chat/completions` endpoint (OpenAI itself, Anthropic through its
 * OpenAI-compatible endpoint, or anything else that speaks the same shape).
 * It is used ONLY as an independent second labeller of the same items, so the
 * gate's numbers can be scored against two label sources instead of one.
 *
 * What it is NOT: it never decides at runtime and never overrides the gate.
 * Code decides, models suggest. The app builds, tests and runs its whole demo
 * path with `evidence/reference-labels.json` absent and no REFERENCE_* env set;
 * `pnpm reference` is the only thing that reads a key, and it reads it from the
 * environment only (never stored, never logged, never put in a URL).
 *
 * Independence rule: the reference model sees the decider instruction, the
 * closed label set, and the raw item text. It never sees the author's few-shot
 * examples, the item id, or the gold label — otherwise it would be grading a
 * copy of the author's own answers instead of producing a second opinion.
 *
 * Fail closed: a reply that is not exactly one label is a ReferenceError naming
 * the item id. Guessing a label from "I think refund" is exactly the failure
 * mode this project exists to remove.
 *
 * Runtime-free: no `window`, no top-level imports except the decider types.
 */

import type { DeciderSpec } from "./decider";

export interface ReferenceConfig {
  /** e.g. https://api.openai.com/v1 (no trailing slash). Never carries the key. */
  baseUrl: string;
  /** e.g. gpt-4.1-mini */
  model: string;
  apiKey: string;
  /** Injected in tests; defaults to the platform fetch. */
  fetchImpl?: typeof fetch;
}

export interface ReferenceLabel {
  id: string;
  /** One of spec.labels. */
  label: string;
  /** The reference model's raw reply, trimmed. Never contains the api key. */
  raw: string;
}

export class ReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferenceError";
  }
}

/** The one line appended to the decider instruction; exported so tests pin it. */
export function referenceReplyRule(labels: string[]): string {
  return `Reply with exactly one label from: ${labels.join(", ")}. No other text.`;
}

/**
 * The exact two messages the reference model sees. No few-shot examples, no
 * gold label, no item id: the reference is an independent labeller, so its
 * answers can disagree with the author's on purpose.
 */
export function buildReferenceMessages(
  spec: DeciderSpec,
  text: string
): Array<{ role: "system" | "user"; content: string }> {
  return [
    { role: "system", content: `${spec.instruction}\n${referenceReplyRule(spec.labels)}` },
    { role: "user", content: text },
  ];
}

/**
 * Accept a reply only when, after lowercasing and stripping quotes,
 * punctuation and whitespace, it equals exactly one label from the closed set.
 * "Refund." -> "refund"; "I think refund" -> null (caller fails closed).
 */
export function parseReferenceReply(raw: string, labels: string[]): string | null {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[\s"']/g, "")
    .replace(/[.,!?;:]+$/g, "");
  if (cleaned.length === 0) return null;
  const exact = labels.filter((l) => l.toLowerCase() === cleaned);
  return exact.length === 1 ? exact[0] : null;
}

/** Replace every occurrence of the key so it can never reach an error message. */
function redactKey(text: string, apiKey: string): string {
  if (!apiKey) return text;
  return text.split(apiKey).join("[redacted]");
}

function readBodySnippet(body: unknown): string {
  let text: string;
  if (typeof body === "string") {
    text = body;
  } else {
    try {
      text = JSON.stringify(body) ?? "";
    } catch {
      text = String(body);
    }
  }
  return text.slice(0, 200);
}

async function labelOne(
  cfg: ReferenceConfig,
  spec: DeciderSpec,
  item: { id: string; text: string }
): Promise<ReferenceLabel> {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const messages = buildReferenceMessages(spec, item.text);
  let res: Response;
  try {
    res = await fetchImpl(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: 0,
        max_tokens: 8,
      }),
    });
  } catch (e) {
    throw new ReferenceError(
      `reference endpoint unreachable: ${redactKey(e instanceof Error ? e.message : String(e), cfg.apiKey)}`
    );
  }
  if (!res.ok) {
    let snippet = "";
    try {
      snippet = readBodySnippet(await res.text());
    } catch {
      snippet = "";
    }
    throw new ReferenceError(
      `reference endpoint answered HTTP ${res.status}: ${redactKey(snippet, cfg.apiKey)}`
    );
  }
  const payload = (await res.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const raw = payload?.choices?.[0]?.message?.content;
  if (typeof raw !== "string") {
    throw new ReferenceError(`reference model returned no reply text for item ${item.id}`);
  }
  const trimmed = raw.trim();
  const label = parseReferenceReply(trimmed, spec.labels);
  if (label === null) {
    throw new ReferenceError(
      `reference model replied ${JSON.stringify(trimmed.slice(0, 80))} for item ${item.id}, which is not exactly one of [${spec.labels.join(", ")}]; refusing to guess`
    );
  }
  return { id: item.id, label, raw: trimmed };
}

/**
 * Label every item with the reference model. Default concurrency 4; the result
 * array is in INPUT order regardless of which request finished first. The first
 * failure rejects: partial reference labels are never written as evidence.
 */
export async function labelWithReference(
  cfg: ReferenceConfig,
  spec: DeciderSpec,
  items: Array<{ id: string; text: string }>,
  opts?: { concurrency?: number }
): Promise<ReferenceLabel[]> {
  const concurrency = Math.max(1, opts?.concurrency ?? 4);
  const out: ReferenceLabel[] = new Array(items.length);
  let next = 0;
  let failure: unknown = null;
  async function worker(): Promise<void> {
    for (;;) {
      if (failure) return;
      const i = next++;
      if (i >= items.length) return;
      try {
        out[i] = await labelOne(cfg, spec, items[i]);
      } catch (e) {
        failure ??= e;
        return;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, worker));
  if (failure) throw failure;
  return out;
}

export interface ReferenceAgreement {
  agree: number;
  total: number;
  rate: number;
}

/**
 * Agreement between two labellers on the same items. This is agreement, NOT
 * accuracy against truth: the author's labels are themselves synthetic, so
 * "95% agreement" means two labellers mostly picked the same label.
 */
export function summarizeReference(
  labels: Array<{ id: string; label: string }>,
  gold: Record<string, string> | Array<{ id: string; gold: string }>
): ReferenceAgreement {
  const goldById = new Map(
    (Array.isArray(gold) ? gold : Object.entries(gold).map(([id, g]) => ({ id, gold: g }))).map((r) => [
      r.id,
      r.gold,
    ])
  );
  let agree = 0;
  for (const l of labels) {
    if (goldById.get(l.id) === l.label) agree++;
  }
  const total = labels.length;
  return { agree, total, rate: total === 0 ? 0 : Math.round((agree / total) * 10000) / 10000 };
}