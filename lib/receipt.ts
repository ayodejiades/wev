/**
 * lib/receipt.ts — Hashed decision receipts for the calibrated gate.
 *
 * A receipt pins one gate decision (input, probabilities, thresholds, verdict)
 * with a sha256 over canonical JSON. app/verify re-checks pasted receipts:
 * hash mismatch means tampered bytes; verdict mismatch means the verdict does
 * not follow from the pinned probabilities and thresholds.
 *
 * Hashing uses globalThis.crypto.subtle, available in browsers and modern
 * Node, so receipts created in tests verify identically in the browser.
 */

import { GATE_THRESHOLDS, evaluateTriageGate } from "./kernel";

export const RECEIPT_KIND = "wev-gate-receipt";
export const RECEIPT_VERSION = 1;
export const GATE_VERSION = "wev-gate-v1";

export interface ReceiptThresholds {
  autoConfidence: number;
  maxEntropyBits: number;
}

export interface ReceiptInput {
  id: string;
  input: string;
  modelId: string;
  deciderVersion: string;
  probabilities: Record<string, number>;
  confidence: number;
  entropyBits: number;
  prediction: string;
  thresholds: ReceiptThresholds;
  verdict: "AUTO" | "ESCALATE";
  path: "AUTO" | "FALLBACK" | "ESCALATE";
}

export interface GateReceipt extends ReceiptInput {
  kind: typeof RECEIPT_KIND;
  version: typeof RECEIPT_VERSION;
  gateVersion: string;
  sha256: string;
}

/** Canonical JSON: object keys sorted recursively, arrays in order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(",")}}`;
}

async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("receipts need globalThis.crypto.subtle (browser or Node 18+)");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Hash a receipt payload (everything except sha256 itself). */
export async function hashReceiptPayload(input: ReceiptInput): Promise<string> {
  return sha256Hex(
    stableStringify({
      kind: RECEIPT_KIND,
      version: RECEIPT_VERSION,
      gateVersion: GATE_VERSION,
      ...input,
    })
  );
}

export async function createReceipt(input: ReceiptInput): Promise<GateReceipt> {
  return {
    kind: RECEIPT_KIND,
    version: RECEIPT_VERSION,
    gateVersion: GATE_VERSION,
    ...input,
    sha256: await hashReceiptPayload(input),
  };
}

export interface ReceiptCheck {
  hashOk: boolean;
  verdictOk: boolean;
  thresholdsMatchCommitted: boolean;
  status: "VERIFIED" | "VERIFIED_OTHER_THRESHOLDS" | "INCONSISTENT" | "TAMPERED" | "MALFORMED";
  problems: string[];
  receipt: GateReceipt | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Re-verify a pasted receipt: hash, verdict recomputation, threshold comparison. */
export async function verifyReceipt(raw: unknown): Promise<ReceiptCheck> {
  const malformed = (problems: string[]): ReceiptCheck => ({
    hashOk: false,
    verdictOk: false,
    thresholdsMatchCommitted: false,
    status: "MALFORMED",
    problems,
    receipt: null,
  });
  const tampered = (problems: string[], receipt: GateReceipt | null = null): ReceiptCheck => ({
    hashOk: false,
    verdictOk: false,
    thresholdsMatchCommitted: false,
    status: "TAMPERED",
    problems,
    receipt,
  });
  if (!isRecord(raw)) return malformed(["receipt is not a JSON object"]);
  const r = raw as Record<string, unknown>;
  if (r.kind !== RECEIPT_KIND) return malformed([`receipt kind is ${JSON.stringify(r.kind)}, want ${JSON.stringify(RECEIPT_KIND)}`]);
  if (r.version !== RECEIPT_VERSION) return malformed([`receipt version is ${JSON.stringify(r.version)}, want ${RECEIPT_VERSION}`]);

  const problems: string[] = [];
  const probs = r.probabilities;
  if (!isRecord(probs)) problems.push("probabilities must be an object");
  const thresholds = r.thresholds as ReceiptThresholds | undefined;
  if (
    !isRecord(thresholds) ||
    typeof thresholds.autoConfidence !== "number" ||
    typeof thresholds.maxEntropyBits !== "number"
  ) {
    problems.push("thresholds must carry numeric autoConfidence and maxEntropyBits");
  }
  if (typeof r.entropyBits !== "number" || typeof r.confidence !== "number") {
    problems.push("confidence and entropyBits must be numbers");
  }
  if (typeof r.sha256 !== "string") problems.push("sha256 must be a string");
  if (problems.length > 0) return tampered(problems);

  const receipt = r as unknown as GateReceipt;
  const { sha256, ...payload } = receipt;
  void sha256;
  const recomputed = await hashReceiptPayload(payload);
  const hashOk = recomputed === receipt.sha256;
  if (!hashOk) {
    return {
      hashOk,
      verdictOk: false,
      thresholdsMatchCommitted: false,
      status: "TAMPERED",
      problems: [`sha256 mismatch: recomputed ${recomputed.slice(0, 16)}… != pinned ${String(receipt.sha256).slice(0, 16)}…`],
      receipt,
    };
  }

  // Hash holds: does the verdict follow from the pinned inputs?
  const gate = evaluateTriageGate(
    { id: receipt.id, probabilities: receipt.probabilities, entropyBits: receipt.entropyBits },
    receipt.thresholds
  );
  const verdictProblems: string[] = [];
  if (gate.verdict !== receipt.verdict) {
    verdictProblems.push(`verdict ${receipt.verdict} does not follow from the pinned probabilities and thresholds (gate says ${gate.verdict})`);
  }
  if (gate.prediction !== receipt.prediction) {
    verdictProblems.push(`prediction ${receipt.prediction} is not the argmax of the pinned probabilities (gate says ${gate.prediction})`);
  }
  if (Math.abs(gate.confidence - receipt.confidence) > 1e-9) {
    verdictProblems.push("confidence is not the max of the pinned probabilities");
  }
  const verdictOk = verdictProblems.length === 0;
  const thresholdsMatchCommitted =
    receipt.thresholds.autoConfidence === GATE_THRESHOLDS.autoConfidence &&
    receipt.thresholds.maxEntropyBits === GATE_THRESHOLDS.maxEntropyBits;

  return {
    hashOk,
    verdictOk,
    thresholdsMatchCommitted,
    status: !verdictOk ? "INCONSISTENT" : thresholdsMatchCommitted ? "VERIFIED" : "VERIFIED_OTHER_THRESHOLDS",
    problems: verdictOk && thresholdsMatchCommitted ? [] : verdictProblems.concat(
      thresholdsMatchCommitted ? [] : ["receipt thresholds differ from this build's committed evidence/thresholds.json"]
    ),
    receipt,
  };
}
