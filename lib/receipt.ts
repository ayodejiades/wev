/**
 * lib/receipt.ts — Hashed decision receipts for the calibrated gate.
 *
 * A receipt pins one gate decision (input, probabilities, thresholds, verdict)
 * with a sha256 over canonical JSON. app/verify re-checks pasted receipts:
 * hash mismatch means tampered bytes; verdict mismatch means the verdict does
 * not follow from the pinned probabilities and thresholds.
 *
 * Version 2 adds a hashed `evidence` block: the sha256 of the evidence files the
 * thresholds came from, and the reference model's identity when one was
 * recorded. A receipt that hashes correctly but names different calibration
 * evidence than this build verifies as VERIFIED_OTHER_THRESHOLDS, never as
 * VERIFIED — that is the whole point: "the verdict follows from these numbers"
 * is a weaker claim than "these numbers came from that calibration run".
 * Version 1 receipts (no evidence block) still verify.
 *
 * Hashing uses globalThis.crypto.subtle, available in browsers and modern
 * Node, so receipts created in tests verify identically in the browser.
 */

import { GATE_THRESHOLDS, evaluateTriageGate } from "./kernel";
import { EVIDENCE_MANIFEST } from "./evidence-manifest";

export const RECEIPT_KIND = "wev-gate-receipt";
export const RECEIPT_VERSION = 2;
/** v1 has no evidence block; both versions verify. Anything else is malformed. */
export const SUPPORTED_RECEIPT_VERSIONS = [1, 2] as const;
export const GATE_VERSION = "wev-gate-v1";

export interface ReceiptThresholds {
  autoConfidence: number;
  maxEntropyBits: number;
}

/** Which calibration evidence a receipt was issued against (hashed into it). */
export interface ReceiptEvidence {
  /** sha256 of evidence/thresholds.json bytes. */
  thresholdsSha256: string;
  /** sha256 of evidence/captured-runs.json bytes. */
  capturedRunsSha256: string;
  /** sha256 of evidence/reference-labels.json bytes, null when none is recorded. */
  referenceSha256: string | null;
  referenceModel: string | null;
  goldSource: "author-synthetic";
}

const MANIFEST = EVIDENCE_MANIFEST;

/**
 * The evidence block for this build, read from evidence/evidence-manifest.json
 * (written by `pnpm claim:verify`). Throws a plain instruction rather than
 * silently emitting a receipt pinned to evidence nobody can check.
 */
export function evidenceFromManifest(): ReceiptEvidence {
  const thresholdsSha256 = MANIFEST.files?.["thresholds.json"];
  const capturedRunsSha256 = MANIFEST.files?.["captured-runs.json"];
  if (!thresholdsSha256 || !capturedRunsSha256) {
    throw new Error("evidence/evidence-manifest.json is incomplete; run pnpm claim:verify");
  }
  return {
    thresholdsSha256,
    capturedRunsSha256,
    referenceSha256: MANIFEST.files?.["reference-labels.json"] ?? null,
    referenceModel: MANIFEST.referenceModel ?? null,
    goldSource: (MANIFEST.goldSource ?? "author-synthetic") as "author-synthetic",
  };
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
  /** Optional: filled from the evidence manifest when the caller omits it. */
  evidence?: ReceiptEvidence;
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

/**
 * Hash a receipt payload (everything except sha256 itself). The version is a
 * parameter so a v1 fixture can be re-hashed exactly as v1 hashed it; new
 * receipts use RECEIPT_VERSION.
 */
export async function hashReceiptPayload(
  input: ReceiptInput,
  version: number = RECEIPT_VERSION
): Promise<string> {
  return sha256Hex(
    stableStringify({
      kind: RECEIPT_KIND,
      version,
      gateVersion: GATE_VERSION,
      ...input,
    })
  );
}

export async function createReceipt(input: ReceiptInput): Promise<GateReceipt> {
  const payload: ReceiptInput = { ...input };
  if (!payload.evidence) payload.evidence = evidenceFromManifest();
  return {
    kind: RECEIPT_KIND,
    version: RECEIPT_VERSION,
    gateVersion: GATE_VERSION,
    ...payload,
    sha256: await hashReceiptPayload(payload),
  };
}

export interface ReceiptCheck {
  hashOk: boolean;
  verdictOk: boolean;
  thresholdsMatchCommitted: boolean;
  /** v1 receipts have no evidence block: reported as matching, never upgraded. */
  evidenceMatchBuild: boolean;
  status: "VERIFIED" | "VERIFIED_OTHER_THRESHOLDS" | "INCONSISTENT" | "TAMPERED" | "MALFORMED";
  problems: string[];
  receipt: GateReceipt | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const EVIDENCE_PROBLEM =
  "receipt was issued against different calibration evidence than this build";

/** Re-verify a pasted receipt: hash, verdict recomputation, threshold comparison. */
export async function verifyReceipt(raw: unknown): Promise<ReceiptCheck> {
  const malformed = (problems: string[]): ReceiptCheck => ({
    hashOk: false,
    verdictOk: false,
    thresholdsMatchCommitted: false,
    evidenceMatchBuild: false,
    status: "MALFORMED",
    problems,
    receipt: null,
  });
  const tampered = (problems: string[], receipt: GateReceipt | null = null): ReceiptCheck => ({
    hashOk: false,
    verdictOk: false,
    thresholdsMatchCommitted: false,
    evidenceMatchBuild: false,
    status: "TAMPERED",
    problems,
    receipt,
  });
  if (!isRecord(raw)) return malformed(["receipt is not a JSON object"]);
  const r = raw as Record<string, unknown>;
  if (r.kind !== RECEIPT_KIND) return malformed([`receipt kind is ${JSON.stringify(r.kind)}, want ${JSON.stringify(RECEIPT_KIND)}`]);
  if (!SUPPORTED_RECEIPT_VERSIONS.includes(r.version as 1 | 2)) {
    return malformed([
      `receipt version is ${JSON.stringify(r.version)}, want one of ${SUPPORTED_RECEIPT_VERSIONS.join(", ")}`,
    ]);
  }

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
  const recomputed = await hashReceiptPayload(payload, r.version as 1 | 2);
  const hashOk = recomputed === receipt.sha256;
  if (!hashOk) {
    return {
      hashOk,
      verdictOk: false,
      thresholdsMatchCommitted: false,
      evidenceMatchBuild: false,
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

  // v1 receipts carry no evidence block: they verify as before, and a status is
  // never upgraded because the block is missing.
  let evidenceMatchBuild = true;
  const evidenceProblems: string[] = [];
  if (receipt.evidence !== undefined) {
    if (!isRecord(receipt.evidence)) {
      evidenceMatchBuild = false;
      evidenceProblems.push("evidence block is not an object");
    } else {
      let build: ReceiptEvidence;
      try {
        build = evidenceFromManifest();
      } catch (e) {
        evidenceMatchBuild = false;
        evidenceProblems.push(e instanceof Error ? e.message : String(e));
        build = {} as ReceiptEvidence;
      }
      const ev = receipt.evidence as unknown as Record<string, unknown>;
      if (ev.thresholdsSha256 !== build.thresholdsSha256) {
        evidenceMatchBuild = false;
        evidenceProblems.push(EVIDENCE_PROBLEM);
      }
      if (ev.capturedRunsSha256 !== build.capturedRunsSha256) {
        evidenceMatchBuild = false;
        evidenceProblems.push(
          `receipt was issued against different captured runs than this build (${String(ev.capturedRunsSha256).slice(0, 12)}… vs ${String(build.capturedRunsSha256).slice(0, 12)}…)`
        );
      }
      if ((ev.referenceSha256 ?? null) !== build.referenceSha256) {
        evidenceMatchBuild = false;
        evidenceProblems.push(
          build.referenceSha256 === null
            ? `receipt names a reference model (${String(ev.referenceModel)}) but this build records no reference evidence`
            : `receipt names different reference evidence than this build (${String(ev.referenceModel)})`
        );
      }
      if ((ev.referenceModel ?? null) !== build.referenceModel) {
        evidenceMatchBuild = false;
        evidenceProblems.push(
          `receipt names reference model ${JSON.stringify(ev.referenceModel ?? null)}, this build has ${JSON.stringify(build.referenceModel)}`
        );
      }
    }
  }

  const problemsAll = verdictOk
    ? evidenceProblems.concat(
        thresholdsMatchCommitted ? [] : ["receipt thresholds differ from this build's committed evidence/thresholds.json"]
      )
    : verdictProblems.concat(evidenceProblems);

  return {
    hashOk,
    verdictOk,
    thresholdsMatchCommitted,
    evidenceMatchBuild,
    status: !verdictOk
      ? "INCONSISTENT"
      : thresholdsMatchCommitted && evidenceMatchBuild
      ? "VERIFIED"
      : "VERIFIED_OTHER_THRESHOLDS",
    problems: problemsAll,
    receipt,
  };
}
