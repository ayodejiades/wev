/**
 * lib/gate-export.ts — Pure builders for the exportable gate.
 *
 * `selectGateTestCases` picks deterministic test cases from committed runs
 * (first auto-correct, first escalated, first wrong auto-action).
 * `buildGateCopyText` renders a self-contained JavaScript gate function with
 * the calibrated thresholds baked in plus those test cases — pasteable into
 * any app, runnable under Node or a browser, no dependencies.
 * `buildGateCard` renders the downloadable gate-card.json object.
 * All inputs come from evidence files; the page supplies them.
 */

import { evaluateTriageGate, type GateThresholds } from "./kernel";

export interface ExportRun {
  id: string;
  probabilities: Record<string, number>;
  confidence: number;
  entropyBits: number;
  correct: boolean;
}

export interface GateTestCase {
  id: string;
  probabilities: Record<string, number>;
  entropyBits: number;
  expect: "AUTO" | "ESCALATE";
}

/** Deterministic archetypes in committed order: auto-correct, escalated, wrong auto. */
export function selectGateTestCases(runs: ExportRun[], thresholds: GateThresholds): GateTestCase[] {
  const scored = runs.map((r) => ({
    ...r,
    auto: evaluateTriageGate(
      { id: r.id, probabilities: r.probabilities, entropyBits: r.entropyBits },
      thresholds
    ).auto,
  }));
  const toCase = (r: (typeof scored)[number]): GateTestCase => ({
    id: r.id,
    probabilities: r.probabilities,
    entropyBits: r.entropyBits,
    expect: r.auto ? "AUTO" : "ESCALATE",
  });
  const cases: GateTestCase[] = [];
  const autoCorrect = scored.find((r) => r.auto && r.correct);
  if (autoCorrect) cases.push(toCase(autoCorrect));
  const escalated = scored.filter((r) => !r.auto);
  if (escalated[0]) cases.push(toCase(escalated[0]));
  const wrongAuto = scored.find((r) => r.auto && !r.correct);
  if (wrongAuto) {
    cases.push(toCase(wrongAuto));
  } else if (escalated[1]) {
    cases.push(toCase(escalated[1]));
  }
  if (cases.length === 0) throw new Error("no runs to build gate test cases from");
  return cases;
}

export interface GateCopyInput {
  modelId: string;
  decider: string;
  thresholds: GateThresholds;
  cases: GateTestCase[];
}

/** Self-contained gate source: baked thresholds, validator, tests. Valid JS (JSDoc-typed). */
export function buildGateCopyText({ modelId, decider, thresholds, cases }: GateCopyInput): string {
  const lines = [
    `// WEV calibrated triage gate: pasted export (model ${modelId}, decider ${decider}).`,
    `// AUTO iff confidence >= ${thresholds.autoConfidence} AND entropyBits <= ${thresholds.maxEntropyBits}, else ESCALATE.`,
    `// Malformed input fails closed to ESCALATE. No dependencies.`,
    `var AUTO_CONFIDENCE = ${thresholds.autoConfidence};`,
    `var MAX_ENTROPY_BITS = ${thresholds.maxEntropyBits};`,
    ``,
    `/** Score one item: probabilities sum to ~1, entropy in bits. */`,
    `function triageGate(probabilities, entropyBits) {`,
    `  var labels = Object.keys(probabilities);`,
    `  var sum = 0;`,
    `  var best = "";`,
    `  var bestP = -1;`,
    `  for (var i = 0; i < labels.length; i++) {`,
    `    var p = probabilities[labels[i]];`,
    `    if (typeof p !== "number" || !(p >= 0 && p <= 1)) {`,
    `      return { prediction: best, confidence: 0, verdict: "ESCALATE" };`,
    `    }`,
    `    sum += p;`,
    `    if (p > bestP) { bestP = p; best = labels[i]; }`,
    `  }`,
    `  if (labels.length === 0 || !(sum >= 0.98 && sum <= 1.02)) {`,
    `    return { prediction: best, confidence: 0, verdict: "ESCALATE" };`,
    `  }`,
    `  if (typeof entropyBits !== "number" || !(entropyBits >= 0)) {`,
    `    return { prediction: best, confidence: 0, verdict: "ESCALATE" };`,
    `  }`,
    `  var confidence = Math.round(bestP * 10000) / 10000;`,
    `  var verdict = bestP >= AUTO_CONFIDENCE && entropyBits <= MAX_ENTROPY_BITS ? "AUTO" : "ESCALATE";`,
    `  return { prediction: best, confidence: confidence, verdict: verdict };`,
    `}`,
    ``,
    `// Generated test cases (committed evidence runs):`,
    `var GATE_TESTS = ${JSON.stringify(cases, null, 2)};`,
    ``,
    `// Minimal check runner (Node or browser console):`,
    `function runGateTests() {`,
    `  return GATE_TESTS.map(function (t) {`,
    `    var got = triageGate(t.probabilities, t.entropyBits);`,
    `    return { id: t.id, expect: t.expect, got: got.verdict, pass: got.verdict === t.expect };`,
    `  });`,
    `}`,
  ];
  return lines.join("\n") + "\n";
}

export interface GateCardInput {
  modelId: string;
  dtype: string;
  decider: string;
  thresholds: GateThresholds;
  seed: number;
  calibrationSize: number;
  heldoutSize: number;
  heldout: {
    coverage: number;
    accuracyAtCoverage: number;
    baselineAccuracy: number;
    wrongAutoActions: number;
    autoHandled: number;
    total: number;
  };
  calibratedAt: string;
  syntheticDataNote: string;
  labelCount: number;
  totalItems: number;
  /**
   * Which calibration evidence backs this gate. Null when the gate was
   * calibrated on this device from the user's own items and no committed
   * evidence run applies.
   */
  evidence?: {
    thresholdsSha256: string;
    capturedRunsSha256: string;
    referenceSha256: string | null;
    referenceModel: string | null;
    goldSource: string;
  } | null;
}

/** Gate-card object: everything a developer needs to reuse or audit the gate. */
export function buildGateCard(input: GateCardInput): Record<string, unknown> {
  return {
    kind: "wev-gate-card",
    version: 1,
    modelId: input.modelId,
    dtype: input.dtype,
    decider: input.decider,
    thresholds: {
      autoConfidence: input.thresholds.autoConfidence,
      maxEntropyBits: input.thresholds.maxEntropyBits,
    },
    seed: input.seed,
    calibrationSize: input.calibrationSize,
    heldoutSize: input.heldoutSize,
    heldoutReport: {
      coverage: input.heldout.coverage,
      accuracyAtCoverage: input.heldout.accuracyAtCoverage,
      baselineAccuracy: input.heldout.baselineAccuracy,
      wrongAutoActions: input.heldout.wrongAutoActions,
      autoHandled: input.heldout.autoHandled,
      total: input.heldout.total,
    },
    calibratedAt: input.calibratedAt,
    evidence: input.evidence ?? null,
    referenceModel: input.evidence?.referenceModel ?? null,
    limits: {
      syntheticDataNote: input.syntheticDataNote,
      labels: input.labelCount,
      totalItems: input.totalItems,
      evidenceNote: input.evidence
        ? "evidence.* are the sha256 digests of the committed calibration files this gate was checked against (evidence/evidence-manifest.json)."
        : "No committed evidence run backs this gate: it was calibrated on this device from the user's own items.",
    },
  };
}
