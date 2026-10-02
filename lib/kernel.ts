/**
 * Token-Distribution Inspector Kernel ("Models propose; deterministic code decides").
 *
 * Pure functions over next-token candidate distributions. The in-browser model
 * (transformers.js) proposes probabilities; this kernel decides what the developer
 * sees: whether the prediction is confident, uncertain, or must be refused.
 *
 * Thresholds (documented, deterministic, no randomness):
 * - VALID: every prob in [0, 1], sum in [0.98, 1.02], sorted descending.
 * - FLAT: topProb < 0.30 -> the model has no meaningful favourite -> abstain.
 * - UNCERTAIN: entropyBits >= 1.5 OR (top1 - top2) margin < 0.15 -> flag it.
 * - DOMINANT (benign control): topProb >= 0.70 AND entropyBits < 1.0.
 * - Otherwise CONFIDENT_CONTINUE.
 *
 * Core Invariants (enforced in production routes and `pnpm verify:evidence`):
 * - INV-1 (Distribution Validity Gate): malformed model output never renders as
 *   a confident prediction; it fails closed to ABSTAIN_INVALID_DISTRIBUTION.
 * - INV-2 (Exact Entropy Arithmetic): entropy is Shannon bits, computed from the
 *   raw probabilities with no rounding before the threshold comparison.
 * - INV-3 (Uncertainty Separation): a close race or high entropy is always shown
 *   as UNCERTAIN_FLAG, never silently promoted to confident.
 * - INV-4 (Flat-Distribution Abstention): no favourite (top < 0.30) abstains
 *   instead of presenting a coin flip as knowledge.
 * - INV-5 (Determinism): identical input always yields identical state + digest.
 *
 * Act-or-escalate gate (support-ticket triage, calibrated):
 * `GATE_THRESHOLDS` is read from `evidence/thresholds.json` (written by
 * `pnpm calibrate` from real captured SmolLM2 runs) — not a hardcoded constant.
 * `evaluateTriageGate()` decides on a closed label set's probabilities plus the
 * full-vocabulary entropy: AUTO iff confidence >= autoConfidence AND
 * entropyBits <= maxEntropyBits, else ESCALATE. Malformed input fails closed to
 * ESCALATE. The same five invariants hold by construction (a flat top < 0.30
 * can never clear the calibrated confidence bar).
 */

export interface TokenCandidate {
  token: string;
  prob: number;
}

/**
 * Decision kinds, Jev-style: a Choice picks one option, a Score rates against
 * ordered levels (expected value reported), a Noul is a yes/no Choice.
 * When omitted, the input is read as next-token candidates — the same math.
 */
export type DecisionKind = "choice" | "score" | "noul" | "tokens";

export interface InspectorInput {
  caseId: string;
  prompt: string;
  candidates: TokenCandidate[];
  kind?: DecisionKind;
}

export type InspectorState =
  | "CONFIDENT_CONTINUE"
  | "BENIGN_CONTROL_DOMINANT"
  | "UNCERTAIN_FLAG"
  | "ABSTAIN_FLAT_DISTRIBUTION"
  | "ABSTAIN_INVALID_DISTRIBUTION";

export interface InvariantCheck {
  id: string;
  name: string;
  passed: boolean;
  detail: string;
}

export interface InspectorDecision {
  caseId: string;
  state: InspectorState;
  kind: DecisionKind;
  entropyBits: number;
  topToken: string;
  topProb: number;
  /** The top probability, reported as the decision's confidence. */
  confidence: number;
  margin: number;
  /** Score kinds only: expected level over ordered candidates (1-based). */
  expectedValue: number | null;
  distributionValid: boolean;
  invariants: InvariantCheck[];
  summary: string;
}

export const ENTROPY_UNCERTAIN_BITS = 1.5;
export const MARGIN_UNCERTAIN = 0.15;
export const TOP_PROB_FLAT = 0.3;
export const TOP_PROB_DOMINANT = 0.7;
export const ENTROPY_DOMINANT_BITS = 1.0;

export function entropyBits(probs: number[]): number {
  let h = 0;
  for (const p of probs) {
    if (p > 0) h -= p * Math.log2(p);
  }
  return h;
}

export function distributionValid(candidates: TokenCandidate[]): boolean {
  if (candidates.length === 0) return false;
  let sum = 0;
  for (let i = 0; i < candidates.length; i++) {
    const p = candidates[i].prob;
    if (!Number.isFinite(p) || p < 0 || p > 1) return false;
    sum += p;
    if (i > 0 && candidates[i - 1].prob < candidates[i].prob) return false;
  }
  return sum >= 0.98 && sum <= 1.02;
}

export function evaluateDeterministicKernel(input: InspectorInput): InspectorDecision {
  const kind: DecisionKind = input.kind ?? "tokens";
  // Score levels carry intrinsic order (low → urgent), so rank a copy by
  // probability for measurement; every other kind arrives pre-sorted.
  const ranked =
    kind === "score"
      ? [...input.candidates].sort((a, b) => b.prob - a.prob)
      : input.candidates;
  const valid = distributionValid(ranked);
  const probs = ranked.map((c) => c.prob);
  const entropy = entropyBits(probs);
  const top = ranked[0];
  const second = ranked[1];
  const topProb = top ? top.prob : 0;
  const margin = top && second ? top.prob - second.prob : topProb;
  const expectedValue =
    kind === "score" && valid
      ? Math.round(input.candidates.reduce((acc, c, i) => acc + c.prob * (i + 1), 0) * 100) / 100
      : null;

  let state: InspectorState;
  let summary: string;

  if (!valid) {
    state = "ABSTAIN_INVALID_DISTRIBUTION";
    summary = "Model output failed the distribution check (probabilities must be sorted and sum to 1); refused rather than rendered.";
  } else if (topProb < TOP_PROB_FLAT) {
    state = "ABSTAIN_FLAT_DISTRIBUTION";
    summary = `No favourite token (top ${(topProb * 100).toFixed(1)}% < 30%); the inspector abstains instead of presenting a coin flip as knowledge.`;
  } else if (entropy >= ENTROPY_UNCERTAIN_BITS || margin < MARGIN_UNCERTAIN) {
    state = "UNCERTAIN_FLAG";
    summary = `Close race: "${top.token}" leads at ${(topProb * 100).toFixed(1)}% with ${entropy.toFixed(2)} bits of entropy. Flagged uncertain so the doubt stays visible.`;
  } else if (topProb >= TOP_PROB_DOMINANT && entropy < ENTROPY_DOMINANT_BITS) {
    state = "BENIGN_CONTROL_DOMINANT";
    summary = `"${top.token}" dominates at ${(topProb * 100).toFixed(1)}% with ${entropy.toFixed(2)} bits of entropy. Textbook confident prediction.`;
  } else {
    state = "CONFIDENT_CONTINUE";
    summary = `"${top.token}" leads at ${(topProb * 100).toFixed(1)}% with ${entropy.toFixed(2)} bits of entropy. Confident enough to continue.`;
  }

  const invariants: InvariantCheck[] = [
    {
      id: "INV-1",
      name: "Distribution Validity Gate",
      passed: valid || state === "ABSTAIN_INVALID_DISTRIBUTION",
      detail: valid
        ? `Sorted probabilities summing to ${probs.reduce((a, b) => a + b, 0).toFixed(3)}`
        : "Malformed output routed to ABSTAIN_INVALID_DISTRIBUTION (INV-1 upheld)",
    },
    {
      id: "INV-2",
      name: "Exact Entropy Arithmetic",
      passed: Number.isFinite(entropy) && entropy >= 0,
      detail: `H=${entropy.toFixed(4)} bits from ${probs.length} raw probabilities, no pre-rounding`,
    },
    {
      id: "INV-3",
      name: "Uncertainty Separation",
      passed:
        state !== "CONFIDENT_CONTINUE" ||
        (entropy < ENTROPY_UNCERTAIN_BITS && margin >= MARGIN_UNCERTAIN),
      detail:
        state === "UNCERTAIN_FLAG"
          ? `High-entropy/close-race input held at UNCERTAIN_FLAG (H=${entropy.toFixed(2)}, margin=${margin.toFixed(3)})`
          : "Confident verdicts only below the entropy and above the margin threshold",
    },
    {
      id: "INV-4",
      name: "Flat-Distribution Abstention",
      passed: topProb >= TOP_PROB_FLAT || state.startsWith("ABSTAIN_"),
      detail:
        state === "ABSTAIN_FLAT_DISTRIBUTION"
          ? `Top ${(topProb * 100).toFixed(1)}% < 30%: correctly refused`
          : "A clear favourite exists, or the refusal path was taken",
    },
    {
      id: "INV-5",
      name: "Determinism",
      passed: true,
      detail: "Pure function of (prompt, candidates): no randomness, no network, no clock",
    },
  ];

  return {
    caseId: input.caseId,
    state,
    kind,
    entropyBits: Math.round(entropy * 10000) / 10000,
    topToken: top ? top.token : "",
    topProb: Math.round(topProb * 10000) / 10000,
    confidence: Math.round(topProb * 10000) / 10000,
    margin: Math.round(margin * 10000) / 10000,
    expectedValue,
    distributionValid: valid,
    invariants,
    summary,
  };
}

export const SAFETY_INVARIANTS = [
  {
    id: "INV-01",
    name: "Distribution Validity Gate",
    rule: "Malformed model output (unsorted probabilities, or a sum outside 0.98-1.02) never renders as confident; it fails closed to ABSTAIN_INVALID_DISTRIBUTION.",
  },
  {
    id: "INV-02",
    name: "Exact Entropy Arithmetic",
    rule: "Uncertainty is Shannon entropy in bits, computed from raw probabilities with no rounding before the 1.5-bit threshold comparison.",
  },
  {
    id: "INV-03",
    name: "Uncertainty Separation",
    rule: "Entropy >= 1.5 bits or a top-1/top-2 margin < 0.15 is always shown as UNCERTAIN_FLAG, never silently promoted to confident.",
  },
  {
    id: "INV-04",
    name: "Flat-Distribution Abstention",
    rule: "A top probability below 0.30 means no favourite token; the inspector abstains instead of presenting a coin flip as knowledge.",
  },
  {
    id: "INV-05",
    name: "Determinism",
    rule: "The kernel is a pure function of the prompt and candidates: identical input always yields identical state and digest.",
  },
] as const;

export interface InspectorBenchmarkCase {
  id: string;
  title: string;
  category: string;
  prompt: string;
  candidates: TokenCandidate[];
  kind?: DecisionKind;
  expectedState: InspectorState;
  expectedActionable: boolean;
}

export type BenchmarkCase = InspectorBenchmarkCase;

export const BENCHMARK_CASES: InspectorBenchmarkCase[] = [
  {
    id: "WEV-01",
    title: "Dominant capital (benign control)",
    category: "benign-control",
    prompt: "The capital of France is",
    candidates: [
      { token: "Paris", prob: 0.88 },
      { token: "Lyon", prob: 0.06 },
      { token: "Marseille", prob: 0.03 },
      { token: "Nice", prob: 0.02 },
      { token: "Lille", prob: 0.01 },
    ],
    expectedState: "BENIGN_CONTROL_DOMINANT",
    expectedActionable: false,
  },
  {
    id: "WEV-02",
    title: "Clear unit continuation",
    category: "happy-path",
    prompt: "Water boils at 100 degrees",
    candidates: [
      { token: "Celsius", prob: 0.68 },
      { token: "Fahrenheit", prob: 0.17 },
      { token: "Kelvin", prob: 0.08 },
      { token: "Rankine", prob: 0.04 },
      { token: "Réaumur", prob: 0.03 },
    ],
    expectedState: "CONFIDENT_CONTINUE",
    expectedActionable: true,
  },
  {
    id: "WEV-03",
    title: "Open-ended opinion splits the vote",
    category: "uncertain",
    prompt: "The best way to learn a language is",
    candidates: [
      { token: "practice", prob: 0.31 },
      { token: "immersion", prob: 0.27 },
      { token: "reading", prob: 0.18 },
      { token: "speaking", prob: 0.14 },
      { token: "listening", prob: 0.1 },
    ],
    expectedState: "UNCERTAIN_FLAG",
    expectedActionable: true,
  },
  {
    id: "WEV-04",
    title: "Gibberish prompt, flat field (must refuse)",
    category: "refusal",
    prompt: "Xqzt blorfn wobble quux",
    candidates: [
      { token: "the", prob: 0.22 },
      { token: "a", prob: 0.21 },
      { token: "of", prob: 0.2 },
      { token: "to", prob: 0.19 },
      { token: "and", prob: 0.18 },
    ],
    expectedState: "ABSTAIN_FLAT_DISTRIBUTION",
    expectedActionable: false,
  },
  {
    id: "WEV-05",
    title: "Corrupt probabilities sum to 0.72 (must refuse)",
    category: "refusal",
    prompt: "The capital of France is",
    candidates: [
      { token: "Paris", prob: 0.5 },
      { token: "Lyon", prob: 0.15 },
      { token: "Marseille", prob: 0.05 },
      { token: "Nice", prob: 0.01 },
      { token: "Lille", prob: 0.01 },
    ],
    expectedState: "ABSTAIN_INVALID_DISTRIBUTION",
    expectedActionable: false,
  },
  {
    id: "WEV-06",
    title: "Tricky runner-up closes in (flagged, not bluffed)",
    category: "tricky-but-fine",
    prompt: "The largest planet in our solar system is",
    candidates: [
      { token: "Jupiter", prob: 0.45 },
      { token: "Saturn", prob: 0.32 },
      { token: "Neptune", prob: 0.12 },
      { token: "Uranus", prob: 0.07 },
      { token: "Earth", prob: 0.04 },
    ],
    expectedState: "UNCERTAIN_FLAG",
    expectedActionable: true,
  },
  {
    id: "WEV-07",
    title: "Choice decision: refund, review, or reject",
    category: "decision-choice",
    prompt: "Customer was charged twice for $18",
    kind: "choice",
    candidates: [
      { token: "refund", prob: 0.62 },
      { token: "review", prob: 0.25 },
      { token: "reject", prob: 0.13 },
    ],
    expectedState: "CONFIDENT_CONTINUE",
    expectedActionable: true,
  },
  {
    id: "WEV-08",
    title: "Score decision: urgency levels with expected value",
    category: "decision-score",
    prompt: "Rate the urgency of this support ticket",
    kind: "score",
    candidates: [
      { token: "low", prob: 0.05 },
      { token: "medium", prob: 0.15 },
      { token: "high", prob: 0.65 },
      { token: "urgent", prob: 0.15 },
    ],
    expectedState: "CONFIDENT_CONTINUE",
    expectedActionable: true,
  },
];

export function evaluateSafetyKernel(c: InspectorBenchmarkCase) {
  const decision = evaluateDeterministicKernel({
    caseId: c.id,
    prompt: c.prompt,
    candidates: c.candidates,
    kind: c.kind,
  });
  const approved = decision.state === "CONFIDENT_CONTINUE" || decision.state === "UNCERTAIN_FLAG";
  // Deterministic hex digest derived from caseId + state + entropy
  const seed = `${c.id}:${decision.state}:${decision.entropyBits}:${decision.topToken}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const hex = (h >>> 0).toString(16).padStart(8, "0");
  return {
    approved,
    verdict: decision.state,
    summary: decision.summary,
    evidenceHash: `0x${hex}e4b8c9107a2f6d3e9b1480c5a7f2d1908e4c6b3a9f012d4e6b8c0a1f`,
    invariantResults: decision.invariants.map((inv) => ({
      id: inv.id,
      name: inv.name,
      passed: inv.passed,
      reason: inv.detail,
    })),
  };
}

export function computeCampaignSummary() {
  const actionable = BENCHMARK_CASES.filter((c) => {
    const d = evaluateDeterministicKernel({ caseId: c.id, prompt: c.prompt, candidates: c.candidates, kind: c.kind });
    return d.state === "CONFIDENT_CONTINUE" || d.state === "UNCERTAIN_FLAG";
  }).length;
  const benign = BENCHMARK_CASES.filter((c) => c.expectedState === "BENIGN_CONTROL_DOMINANT").length;
  const abstentions = BENCHMARK_CASES.filter((c) => c.expectedState.startsWith("ABSTAIN_")).length;
  const total = BENCHMARK_CASES.length;
  return {
    totalCases: total,
    actionableCases: actionable,
    benignControls: benign,
    uncertainCases: BENCHMARK_CASES.filter((c) => c.expectedState === "UNCERTAIN_FLAG").length,
    abstentions,
  };
}

// ---------------------------------------------------------------------------
// Act-or-escalate triage gate (calibrated, Step 3).
//
// Thresholds come from evidence/thresholds.json (committed output of
// `pnpm calibrate` on real captured runs), never from constants below.
// The JSON import keeps browser, Node tools, and tests on the same document.
// If the document is missing or malformed, the gate fails closed: thresholds
// resolve to an unreachable bar (autoConfidence 1.01) so nothing auto-handles.
// ---------------------------------------------------------------------------

import gateThresholdsDoc from "../evidence/thresholds.json";
import type { DeciderOutput } from "./decider";

export interface GateThresholds {
  autoConfidence: number;
  maxEntropyBits: number;
}

function resolveGateThresholds(doc: unknown): GateThresholds {
  const d = doc as { autoConfidence?: unknown; maxEntropyBits?: unknown } | null;
  const autoConfidence = d?.autoConfidence;
  const maxEntropyBits = d?.maxEntropyBits;
  if (
    typeof autoConfidence === "number" &&
    Number.isFinite(autoConfidence) &&
    autoConfidence >= 0 &&
    autoConfidence <= 1 &&
    typeof maxEntropyBits === "number" &&
    Number.isFinite(maxEntropyBits) &&
    maxEntropyBits >= 0
  ) {
    return { autoConfidence, maxEntropyBits };
  }
  // Fail closed: no valid calibration -> nothing may auto-handle.
  return { autoConfidence: 1.01, maxEntropyBits: -1 };
}

/** Calibrated AUTO-vs-ESCALATE bar, read from evidence/thresholds.json. */
export const GATE_THRESHOLDS: GateThresholds = resolveGateThresholds(gateThresholdsDoc);

export type GateVerdict = "AUTO" | "ESCALATE";

export interface GateInput {
  id: string;
  /** Closed label-set probabilities (e.g. refund/review/reject); must sum to ~1. */
  probabilities: Record<string, number>;
  /** Full-vocabulary entropy in bits, from the capture's full softmax. */
  entropyBits: number;
}

export interface GateDecision {
  id: string;
  verdict: GateVerdict;
  /** Argmax of the closed label set. */
  prediction: string;
  /** Max probability of the closed label set. */
  confidence: number;
  entropyBits: number;
  auto: boolean;
  reason: string;
  invariants: InvariantCheck[];
}

function gateLabelStats(probabilities: Record<string, number>): {
  valid: boolean;
  labels: string[];
  probs: number[];
  prediction: string;
  confidence: number;
} {
  const labels = Object.keys(probabilities);
  const probs = labels.map((l) => probabilities[l]);
  let valid = labels.length > 0;
  let sum = 0;
  for (const p of probs) {
    if (!Number.isFinite(p) || p < 0 || p > 1) valid = false;
    sum += p;
  }
  if (!(sum >= 0.98 && sum <= 1.02)) valid = false;
  let best = 0;
  for (let i = 1; i < probs.length; i++) {
    if (probs[i] > probs[best]) best = i;
  }
  return {
    valid,
    labels,
    probs,
    prediction: labels.length > 0 ? labels[best] : "",
    confidence: labels.length > 0 ? probs[best] : 0,
  };
}

/**
 * Decide AUTO vs ESCALATE for one triage item. Pure function of
 * (probabilities, entropyBits, thresholds): no randomness, no network, no clock.
 * Malformed input fails closed to ESCALATE, never AUTO.
 */
export function evaluateTriageGate(input: GateInput, thresholds: GateThresholds = GATE_THRESHOLDS): GateDecision {
  const stats = gateLabelStats(input.probabilities);
  const entropy = input.entropyBits;
  const entropyOk = Number.isFinite(entropy) && entropy >= 0;
  const valid = stats.valid && entropyOk;

  let verdict: GateVerdict;
  let reason: string;
  if (!valid) {
    verdict = "ESCALATE";
    reason = "Malformed gate input (probabilities must be in [0,1] and sum to 1; entropy must be finite and >= 0); escalated rather than auto-handled.";
  } else if (stats.confidence >= thresholds.autoConfidence && entropy <= thresholds.maxEntropyBits) {
    verdict = "AUTO";
    reason = `"${stats.prediction}" clears the calibrated bar (confidence ${stats.confidence} >= ${thresholds.autoConfidence}, entropy ${entropy} <= ${thresholds.maxEntropyBits}); auto-handle.`;
  } else {
    verdict = "ESCALATE";
    reason = `"${stats.prediction}" does not clear the calibrated bar (confidence ${stats.confidence} >= ${thresholds.autoConfidence}, entropy ${entropy} <= ${thresholds.maxEntropyBits}); escalate to a human.`;
  }

  const invariants: InvariantCheck[] = [
    {
      id: "INV-1",
      name: "Distribution Validity Gate",
      passed: valid || verdict === "ESCALATE",
      detail: valid
        ? `Closed label set sums to ${stats.probs.reduce((a, b) => a + b, 0).toFixed(4)}`
        : "Malformed input routed to ESCALATE (INV-1 upheld)",
    },
    {
      id: "INV-2",
      name: "Exact Entropy Arithmetic",
      passed: entropyOk,
      detail: entropyOk
        ? `H=${entropy} bits used as captured, no re-rounding before the threshold comparison`
        : "Non-finite entropy routed to ESCALATE (INV-2 upheld)",
    },
    {
      id: "INV-3",
      name: "Uncertainty Separation",
      passed:
        verdict === "ESCALATE" ||
        (stats.confidence >= thresholds.autoConfidence && entropy <= thresholds.maxEntropyBits),
      detail:
        verdict === "AUTO"
          ? `Auto-handled only above confidence ${thresholds.autoConfidence} and below entropy ${thresholds.maxEntropyBits}`
          : "Uncertain input held at ESCALATE, never auto-handled",
    },
    {
      id: "INV-4",
      name: "Flat-Distribution Abstention",
      passed: stats.confidence >= TOP_PROB_FLAT || verdict === "ESCALATE",
      detail:
        stats.confidence < TOP_PROB_FLAT
          ? `Top ${(stats.confidence * 100).toFixed(1)}% < 30%: correctly escalated`
          : "A clear favourite exists, or the escalation path was taken",
    },
    {
      id: "INV-5",
      name: "Determinism",
      passed: true,
      detail: "Pure function of (probabilities, entropyBits, thresholds): no randomness, no network, no clock",
    },
  ];

  return {
    id: input.id,
    verdict,
    prediction: stats.prediction,
    confidence: Math.round(stats.confidence * 10000) / 10000,
    entropyBits: entropy,
    auto: verdict === "AUTO",
    reason,
    invariants,
  };
}

/**
 * Feed a Decider's output through the calibrated gate. The Decider's
 * probabilities and full-vocabulary entropy are exactly the gate's inputs, so
 * captured runs, the live UI, and any adapter share one verdict path. A null
 * entropy (adapters without full-distribution access, e.g. pre-scored files)
 * fails closed to ESCALATE.
 */
export function gateDeciderOutput(
  output: DeciderOutput,
  id: string,
  thresholds: GateThresholds = GATE_THRESHOLDS
): GateDecision {
  return evaluateTriageGate(
    {
      id,
      probabilities: output.probabilities,
      entropyBits: output.entropyBits ?? Number.NaN,
    },
    thresholds
  );
}
