// tests/health.test.mjs — a real test that must pass in DEMO_MODE without a database.
// Uses Node's built-in test runner (`node --test`), no extra dependency.
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DEMO_MODE = "1";

test("listRecords and createRecord round-trip in DEMO_MODE", async () => {
  const { listRecords, createRecord } = await import("../db/index.ts");
  const before = await listRecords();
  assert.ok(Array.isArray(before));
  assert.ok(before.length >= 1, "fixtures/records.json should seed at least one row");

  const created = await createRecord("test row");
  assert.equal(created.title, "test row");

  const after = await listRecords();
  assert.equal(after.length, before.length + 1);
});

test("token-distribution kernel: confident, uncertain, and refusal paths", async () => {
  const { evaluateDeterministicKernel } = await import("../lib/kernel.ts");

  const confident = evaluateDeterministicKernel({
    caseId: "c1",
    prompt: "Water boils at 100 degrees",
    candidates: [
      { token: "Celsius", prob: 0.68 },
      { token: "Fahrenheit", prob: 0.17 },
      { token: "Kelvin", prob: 0.08 },
      { token: "Rankine", prob: 0.04 },
      { token: "Réaumur", prob: 0.03 },
    ],
  });
  assert.equal(confident.state, "CONFIDENT_CONTINUE");
  assert.equal(confident.distributionValid, true);
  assert.equal(confident.topToken, "Celsius");

  const uncertain = evaluateDeterministicKernel({
    caseId: "c2",
    prompt: "The best way to learn a language is",
    candidates: [
      { token: "practice", prob: 0.31 },
      { token: "immersion", prob: 0.27 },
      { token: "reading", prob: 0.18 },
      { token: "speaking", prob: 0.14 },
      { token: "listening", prob: 0.1 },
    ],
  });
  assert.equal(uncertain.state, "UNCERTAIN_FLAG");
  assert.ok(uncertain.entropyBits >= 1.5);

  const refused = evaluateDeterministicKernel({
    caseId: "c3",
    prompt: "Xqzt blorfn wobble quux",
    candidates: [
      { token: "the", prob: 0.22 },
      { token: "a", prob: 0.21 },
      { token: "of", prob: 0.2 },
      { token: "to", prob: 0.19 },
      { token: "and", prob: 0.18 },
    ],
  });
  assert.equal(refused.state, "ABSTAIN_FLAT_DISTRIBUTION");
  assert.equal(refused.distributionValid, true);

  const corrupt = evaluateDeterministicKernel({
    caseId: "c4",
    prompt: "The capital of France is",
    candidates: [
      { token: "Paris", prob: 0.5 },
      { token: "Lyon", prob: 0.15 },
      { token: "Marseille", prob: 0.05 },
      { token: "Nice", prob: 0.01 },
      { token: "Lille", prob: 0.01 },
    ],
  });
  assert.equal(corrupt.state, "ABSTAIN_INVALID_DISTRIBUTION");
  assert.equal(corrupt.distributionValid, false);
});

test("live model top-k renormalization feeds a valid kernel distribution", async () => {
  const { renormalizeTopK } = await import("../lib/wev-model.ts");
  const { evaluateDeterministicKernel } = await import("../lib/kernel.ts");

  // Realistic raw top-5 from a small model: sums to ~0.56, never to 1.
  const raw = [
    { token: " Paris", prob: 0.28 },
    { token: " London", prob: 0.12 },
    { token: " Berlin", prob: 0.07 },
    { token: " Madrid", prob: 0.05 },
    { token: " Rome", prob: 0.04 },
  ];
  const normed = renormalizeTopK(raw);
  assert.equal(normed.length, raw.length);
  const sum = normed.reduce((a, c) => a + c.prob, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `renormalized top-k must sum to 1, got ${sum}`);
  for (let i = 1; i < normed.length; i++) {
    assert.ok(normed[i - 1].prob >= normed[i].prob, "renormalized output stays sorted descending");
  }
  assert.equal(normed[0].token, " Paris", "renormalization preserves the leader");

  const decision = evaluateDeterministicKernel({
    caseId: "live-sim",
    prompt: "The capital of France is",
    candidates: normed,
  });
  assert.equal(decision.distributionValid, true);
  assert.notEqual(decision.state, "ABSTAIN_INVALID_DISTRIBUTION");
});

test("decision kinds: choice confidence and score expected value", async () => {
  const { evaluateDeterministicKernel } = await import("../lib/kernel.ts");

  const choice = evaluateDeterministicKernel({
    caseId: "c5",
    prompt: "Customer was charged twice for $18",
    kind: "choice",
    candidates: [
      { token: "refund", prob: 0.62 },
      { token: "review", prob: 0.25 },
      { token: "reject", prob: 0.13 },
    ],
  });
  assert.equal(choice.state, "CONFIDENT_CONTINUE");
  assert.equal(choice.confidence, 0.62);

  const score = evaluateDeterministicKernel({
    caseId: "c6",
    prompt: "Rate the urgency of this support ticket",
    kind: "score",
    candidates: [
      { token: "low", prob: 0.05 },
      { token: "medium", prob: 0.15 },
      { token: "high", prob: 0.65 },
      { token: "urgent", prob: 0.15 },
    ],
  });
  assert.equal(score.state, "CONFIDENT_CONTINUE");
  assert.equal(score.expectedValue, 2.9);
});

test("triage gate thresholds come from evidence/thresholds.json", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { GATE_THRESHOLDS } = await import("../lib/kernel.ts");

  const doc = JSON.parse(fs.readFileSync(path.join(process.cwd(), "evidence", "thresholds.json"), "utf8"));
  assert.equal(GATE_THRESHOLDS.autoConfidence, doc.autoConfidence);
  assert.equal(GATE_THRESHOLDS.maxEntropyBits, doc.maxEntropyBits);
});

test("triage gate verdicts on captured runs reproduce calibration.json", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { evaluateTriageGate, GATE_THRESHOLDS } = await import("../lib/kernel.ts");

  const captured = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "evidence", "captured-runs.json"), "utf8")
  );
  const calibration = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "evidence", "calibration.json"), "utf8")
  );
  assert.ok(captured.runs.length >= 20, "need captured runs to check the gate against");

  const byId = new Map(captured.runs.map((r) => [r.id, r]));
  for (const run of captured.runs) {
    const decision = evaluateTriageGate({
      id: run.id,
      probabilities: run.probabilities,
      entropyBits: run.entropyBits,
    });
    // The kernel derives prediction/confidence the same way capture did.
    assert.equal(decision.prediction, run.prediction, `${run.id}: prediction must match capture`);
    assert.ok(Math.abs(decision.confidence - run.confidence) < 1e-9, `${run.id}: confidence must match capture`);
    assert.ok(decision.invariants.every((i) => i.passed), `${run.id}: gate invariants must hold`);
    const expectAuto =
      run.confidence >= GATE_THRESHOLDS.autoConfidence && run.entropyBits <= GATE_THRESHOLDS.maxEntropyBits;
    assert.equal(decision.auto, expectAuto, `${run.id}: AUTO rule must follow calibrated thresholds`);
  }

  // Recompute the per-split gate reports and compare with the committed calibration.
  for (const split of ["calibration", "heldout"]) {
    const ids = split === "calibration" ? calibration.split.calibrationIds : calibration.split.heldoutIds;
    const rows = ids.map((id) => byId.get(id));
    assert.equal(rows.length, calibration.gate[split].total);
    const auto = rows.filter(
      (r) => r.confidence >= GATE_THRESHOLDS.autoConfidence && r.entropyBits <= GATE_THRESHOLDS.maxEntropyBits
    );
    const committed = calibration.gate[split];
    assert.equal(auto.length, committed.autoHandled, `${split}: auto-handled count`);
    assert.equal(rows.length - auto.length, committed.escalated, `${split}: escalated count`);
    assert.equal(auto.filter((r) => !r.correct).length, committed.wrongAutoActions, `${split}: wrong auto-actions`);
    const acc = auto.length ? auto.filter((r) => r.correct).length / auto.length : 0;
    assert.ok(
      Math.abs(Math.round(acc * 10000) / 10000 - committed.accuracyAtCoverage) < 1e-9,
      `${split}: accuracy at coverage`
    );
  }
});

test("triage gate fails closed on malformed input", async () => {
  const { evaluateTriageGate } = await import("../lib/kernel.ts");

  const badSum = evaluateTriageGate({
    id: "bad-sum",
    probabilities: { refund: 0.5, review: 0.15, reject: 0.05 },
    entropyBits: 1.2,
  });
  assert.equal(badSum.verdict, "ESCALATE");
  assert.ok(badSum.invariants.every((i) => i.passed));

  const negative = evaluateTriageGate({
    id: "negative",
    probabilities: { refund: 1.2, review: -0.1, reject: -0.1 },
    entropyBits: 1.2,
  });
  assert.equal(negative.verdict, "ESCALATE");

  const nanEntropy = evaluateTriageGate({
    id: "nan-entropy",
    probabilities: { refund: 0.6, review: 0.3, reject: 0.1 },
    entropyBits: Number.NaN,
  });
  assert.equal(nanEntropy.verdict, "ESCALATE");

  // Determinism: identical input yields identical verdict.
  const input = {
    id: "det",
    probabilities: { refund: 0.62, review: 0.25, reject: 0.13 },
    entropyBits: 1.31,
  };
  const a = evaluateTriageGate(input);
  const b = evaluateTriageGate(input);
  assert.deepEqual(a, b);
});

function mockAdapter(logProbsByLabel, { entropyBits = 1.0, modelId = "mock-adapter" } = {}) {
  return {
    adapterKind: "mock",
    modelId,
    async score(_prompt, labels) {
      return {
        labelLogProbs: labels.map((l) => logProbsByLabel[l]),
        entropyBits,
        modelId,
      };
    },
  };
}

test("decider: labels sharing a first token score full sequences", async () => {
  const { decide } = await import("../lib/decider.ts");
  // "refund express" shares its first token with "refund": a first-token-only
  // scorer would conflate them. Full-sequence log-probs keep them apart.
  const spec = {
    name: "prefix-test",
    kind: "choice",
    labels: ["refund", "refund express", "review"],
    instruction: "Pick one.",
    version: "test-v1",
  };
  const out = await decide(
    mockAdapter({ refund: -0.2, "refund express": -1.0, review: -2.0 }),
    spec,
    "some ticket"
  );
  // Hand-computed: exps 0.8187/0.3679/0.1353 over sum 1.3219.
  assert.equal(out.value, "refund");
  assert.equal(out.confidence, 0.6193);
  assert.deepEqual(Object.keys(out.probabilities), ["refund", "refund express", "review"]);
  assert.ok(Math.abs(out.probabilities["refund express"] - 0.2783) < 1e-4);
  assert.equal(out.deciderVersion, "test-v1");
});

test("decider: score and noul kinds pick the argmax value", async () => {
  const { decide } = await import("../lib/decider.ts");

  const score = await decide(
    mockAdapter({ low: -3.0, medium: -2.0, high: -0.5, urgent: -1.5 }),
    { name: "urgency", kind: "score", labels: ["low", "medium", "high", "urgent"], instruction: "Rate.", version: "t" },
    "ticket"
  );
  assert.equal(score.value, "high");
  assert.ok(score.confidence > 0.5 && score.confidence < 0.7);

  const noul = await decide(
    mockAdapter({ yes: -0.3, no: -1.2 }),
    { name: "confirm", kind: "noul", labels: ["yes", "no"], instruction: "Answer.", version: "t" },
    "ticket"
  );
  assert.equal(noul.value, "yes");
  assert.equal(noul.confidence, 0.7109);
});

test("decider: malformed adapter output fails closed", async () => {
  const { decide, DeciderError } = await import("../lib/decider.ts");
  const { gateDeciderOutput } = await import("../lib/kernel.ts");
  const spec = {
    name: "t",
    kind: "choice",
    labels: ["refund", "review", "reject"],
    instruction: "Pick.",
    version: "t",
  };

  await assert.rejects(
    decide(
      { adapterKind: "mock", modelId: "m", score: async () => ({ labelLogProbs: [-0.5], entropyBits: 1, modelId: "m" }) },
      spec,
      "x"
    ),
    DeciderError
  );
  await assert.rejects(
    decide(mockAdapter({ refund: Number.NaN, review: -1, reject: -2 }), spec, "x"),
    DeciderError
  );

  // Garbage that reaches the kernel directly escalates, never auto-handles.
  const garbage = gateDeciderOutput(
    {
      value: "refund",
      probabilities: { refund: 0.5, review: 0.1, reject: 0.05 },
      confidence: 0.5,
      entropyBits: 1.0,
      modelId: "m",
      deciderVersion: "t",
    },
    "garbage"
  );
  assert.equal(garbage.verdict, "ESCALATE");

  // No full-vocabulary entropy (pre-scored/server adapters) also escalates.
  const noEntropy = gateDeciderOutput(
    {
      value: "refund",
      probabilities: { refund: 0.9, review: 0.06, reject: 0.04 },
      confidence: 0.9,
      entropyBits: null,
      modelId: "prescored-file",
      deciderVersion: "t",
    },
    "no-entropy"
  );
  assert.equal(noEntropy.verdict, "ESCALATE");
});

test("decider: triage prompts are byte-identical to captured runs", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { TRIAGE_DECIDER, buildDeciderPrompt } = await import("../lib/decider.ts");

  const captured = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "evidence", "captured-runs.json"), "utf8")
  );
  assert.ok(captured.runs.length >= 20);
  for (const run of captured.runs) {
    assert.equal(buildDeciderPrompt(TRIAGE_DECIDER, run.text), run.prompt, `${run.id}: prompt drift`);
  }
  assert.equal(buildDeciderPrompt(TRIAGE_DECIDER, "<TEXT>"), captured.promptTemplate, "template drift");
});

test("decider: label token spans reject boundary merges", async () => {
  const { labelTokenSpan, DeciderError } = await import("../lib/decider.ts");
  assert.deepEqual(labelTokenSpan([10, 20, 30], [10, 20, 30, 40, 50]), [40, 50]);
  assert.throws(() => labelTokenSpan([10, 20, 30], [10, 99, 30, 40]), DeciderError);
  assert.throws(() => labelTokenSpan([10, 20, 30], [10, 20]), DeciderError);
});

test("decider: local server adapter reports clear errors", async () => {
  const { createLocalServerAdapter, DeciderError } = await import("../lib/decider.ts");

  const unreachable = createLocalServerAdapter({
    baseUrl: "http://127.0.0.1:9",
    model: "x",
    fetchImpl: async () => {
      throw new TypeError("fetch failed");
    },
  });
  await assert.rejects(unreachable.score("P", ["refund"]), /cross-origin|unreachable/i);

  const noLogprobs = createLocalServerAdapter({
    baseUrl: "http://localhost:11434",
    model: "x",
    fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ text: " refund" }] }) }),
  });
  await assert.rejects(noLogprobs.score("P", ["refund"]), /log-probs/i);

  const working = createLocalServerAdapter({
    baseUrl: "http://localhost:8080",
    model: "x",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        choices: [{ logprobs: { top_logprobs: [{ " refund": -0.1, " review": -2.0 }] } }],
      }),
    }),
  });
  const scores = await working.score("P", ["refund", "review"]);
  assert.ok(scores.labelLogProbs[0] > scores.labelLogProbs[1]);
  assert.equal(scores.entropyBits, null);
  assert.ok(working.adapterKind.includes("EXPERIMENTAL"));
});

test("decider: pre-scored importer replays files without a model", async () => {
  const {
    parsePrescoredJson,
    parsePrescoredCsv,
    createPrescoredAdapter,
    decide,
    DeciderError,
  } = await import("../lib/decider.ts");
  const spec = {
    name: "t",
    kind: "choice",
    labels: ["refund", "review", "reject"],
    instruction: "Pick.",
    version: "t",
  };

  const rows = parsePrescoredJson(
    JSON.stringify([
      { text: "charged twice", gold: "refund", probabilities: { refund: 0.8, review: 0.15, reject: 0.05 } },
      { text: "where is my order", gold: "review", predicted: "review", confidence: 0.7 },
    ]),
    spec.labels
  );
  assert.equal(rows.length, 2);
  const out = await decide(createPrescoredAdapter(rows, spec), spec, "charged twice");
  assert.equal(out.value, "refund");
  assert.equal(out.confidence, 0.8);

  const csv = parsePrescoredCsv(
    'text,gold,prob_refund,prob_review,prob_reject\n"hello, world",review,0.1,0.8,0.1',
    spec.labels
  );
  assert.equal(csv[0].text, "hello, world");
  assert.equal(csv[0].probabilities.review, 0.8);

  assert.throws(
    () => parsePrescoredJson(JSON.stringify([{ text: "x", predicted: "refund", confidence: 0.9 }]), ["a", "b"]),
    DeciderError
  );
  assert.throws(() => parsePrescoredCsv("text,gold\nx,refund", spec.labels), DeciderError);

  const adapter = createPrescoredAdapter(rows, spec);
  await assert.rejects(adapter.score("unseen prompt", spec.labels), /escalate/i);
});

test("kernel consumes decider output through one gate", async () => {
  const { decide, TRIAGE_DECIDER } = await import("../lib/decider.ts");
  const { gateDeciderOutput } = await import("../lib/kernel.ts");

  const out = await decide(
    mockAdapter({ refund: -0.1, review: -2.5, reject: -3.0 }, { entropyBits: 4.5 }),
    TRIAGE_DECIDER,
    "charged twice, refund please"
  );
  assert.equal(out.value, "refund");

  const permissive = gateDeciderOutput(out, "d1", { autoConfidence: 0.5, maxEntropyBits: 99 });
  assert.equal(permissive.verdict, "AUTO");
  assert.equal(permissive.prediction, "refund");

  const strict = gateDeciderOutput(out, "d1", { autoConfidence: 0.999, maxEntropyBits: 99 });
  assert.equal(strict.verdict, "ESCALATE");
});

function generativeMock(logProbsByLabel, { entropyBits = 1.0, genText = "generated reply" } = {}) {
  const calls = { score: 0, generate: 0, generateInputs: [] };
  const modelId = "mock-generative";
  return {
    calls,
    adapter: {
      adapterKind: "mock-generative",
      modelId,
      async score(_prompt, labels) {
        calls.score++;
        return { labelLogProbs: labels.map((l) => logProbsByLabel[l]), entropyBits, modelId };
      },
      async generate(input, _opts) {
        calls.generate++;
        calls.generateInputs.push(input);
        return { text: genText, modelId };
      },
    },
  };
}

const JEVIFY_SPEC = {
  name: "triage",
  kind: "choice",
  labels: ["refund", "review", "reject"],
  instruction: "Pick one.",
  version: "t",
};

test("jevify: AUTO never calls generate()", async () => {
  const { jevify } = await import("../lib/jevify.ts");
  const { calls, adapter } = generativeMock({ refund: -0.1, review: -2.5, reject: -3.0 });
  const routed = await jevify(adapter, JEVIFY_SPEC, { autoConfidence: 0.5, maxEntropyBits: 99 }).route(
    "charged twice, refund please"
  );
  assert.equal(routed.path, "AUTO");
  assert.equal(routed.value, "refund");
  assert.equal(calls.score, 1, "decide() scores in one pass");
  assert.equal(calls.generate, 0, "AUTO must never touch generate()");
});

test("jevify: FALLBACK calls generate() exactly once with the raw input", async () => {
  const { jevify, FALLBACK_WARNING } = await import("../lib/jevify.ts");
  const input = "my bill looks odd, not sure what I want";
  const { calls, adapter } = generativeMock(
    { refund: -1.1, review: -1.0, reject: -1.2 },
    { genText: "let me look into your bill" }
  );
  const routed = await jevify(adapter, JEVIFY_SPEC, { autoConfidence: 0.5, maxEntropyBits: 99 }).route(input);
  assert.equal(routed.path, "FALLBACK");
  assert.equal(calls.generate, 1, "FALLBACK calls generate() exactly once");
  assert.equal(calls.generateInputs[0], input, "generate() gets the raw input, unwrapped");
  assert.equal(routed.text, "let me look into your bill");
  assert.equal(routed.unverified, true);
  assert.equal(routed.warning, FALLBACK_WARNING);
  assert.match(routed.warning, /no calibrated confidence/);
});

test("jevify: adapter generate() is byte-identical to calling the model directly", async () => {
  const { createLogitsAdapter } = await import("../lib/decider.ts");
  const seen = {};
  const tokenizer = async (text) => {
    seen.tokenized = text;
    return { input_ids: { tolist: () => [[7, 8]] } };
  };
  tokenizer.decode = (ids) => {
    seen.decoded = ids;
    return "free text";
  };
  const model = async () => {
    throw new Error("score path unused here");
  };
  model.generate = async (inputs) => {
    seen.genInputs = inputs;
    return { tolist: () => [[7, 8, 9]] };
  };
  const adapter = createLogitsAdapter({ tokenizer, model, modelId: "m" });

  const { jevify } = await import("../lib/jevify.ts");
  const out = await jevify(adapter, JEVIFY_SPEC, { autoConfidence: 0.5, maxEntropyBits: 99 }).generate(
    "hello ticket",
    { maxNewTokens: 32 }
  );
  assert.equal(out.text, "free text");
  assert.equal(seen.tokenized, "hello ticket", "tokenizer sees the raw input, no decider prompt");
  assert.deepEqual(seen.decoded, [9], "only ids past the input prefix reach decode");
  assert.equal(seen.genInputs.max_new_tokens, 32, "opts pass through untouched");
  assert.equal(seen.genInputs.do_sample, false);
});

test("jevify: score-only adapters throw and route to ESCALATE", async () => {
  const { createPrescoredAdapter } = await import("../lib/decider.ts");
  const { jevify } = await import("../lib/jevify.ts");
  const rows = [
    { text: "vague billing question", probabilities: { refund: 0.4, review: 0.35, reject: 0.25 }, entropyBits: 2.0 },
  ];
  const app = jevify(createPrescoredAdapter(rows, JEVIFY_SPEC), JEVIFY_SPEC, {
    autoConfidence: 0.5,
    maxEntropyBits: 99,
  });

  await assert.rejects(app.generate("vague billing question"), /score-only|no text generation/i);
  const decided = await app.decide("vague billing question");
  assert.equal(decided.verdict, "ESCALATE");
  const routed = await app.route("vague billing question");
  assert.equal(routed.path, "ESCALATE", "no generator means no FALLBACK, even for well-formed input");
});

test("jevify: malformed decider output never reaches generate()", async () => {
  const { jevify } = await import("../lib/jevify.ts");
  const { DeciderError } = await import("../lib/decider.ts");
  const broken = {
    adapterKind: "mock-generative",
    modelId: "m",
    async score() {
      return { labelLogProbs: [-0.5], entropyBits: 1, modelId: "m" };
    },
    async generate() {
      throw new Error("must never be called");
    },
  };
  const app = jevify(broken, JEVIFY_SPEC, { autoConfidence: 0.5, maxEntropyBits: 99 });
  await assert.rejects(app.route("anything"), DeciderError);
});

test("inbox: deterministic subset and live counters", async () => {
  const { selectInboxIds, summarizeInbox } = await import("../lib/inbox.ts");

  assert.deepEqual(selectInboxIds(["a", "b", "c", "d"], 2), ["a", "b"]);
  assert.throws(() => selectInboxIds(["a"], 2), /only 1 committed/);

  const counters = summarizeInbox([
    { auto: true, correct: true },
    { auto: true, correct: false },
    { auto: false, correct: false },
    { auto: false, correct: true },
  ]);
  assert.deepEqual(counters, {
    total: 4,
    autoHandled: 2,
    escalated: 2,
    wrongAutoActions: 1,
    alwaysTrustWrong: 2,
  });
  assert.deepEqual(summarizeInbox([]), {
    total: 0,
    autoHandled: 0,
    escalated: 0,
    wrongAutoActions: 0,
    alwaysTrustWrong: 0,
  });
});

test("receipts: round-trip, tamper, and verdict checks", async () => {
  const { createReceipt, verifyReceipt } = await import("../lib/receipt.ts");
  const input = {
    id: "T-001",
    input: "charged twice",
    modelId: "m",
    deciderVersion: "triage-v1",
    probabilities: { refund: 0.8394, review: 0.1331, reject: 0.0275 },
    confidence: 0.8394,
    entropyBits: 5.5678,
    prediction: "refund",
    thresholds: { autoConfidence: 0.5, maxEntropyBits: 6 },
    verdict: "AUTO",
    path: "AUTO",
  };
  const first = await createReceipt(input);
  const second = await createReceipt(input);
  assert.equal(first.sha256, second.sha256, "receipts are deterministic");
  assert.equal(first.sha256.length, 64);

  const ok = await verifyReceipt(JSON.parse(JSON.stringify(first)));
  assert.equal(ok.status, "VERIFIED");
  assert.deepEqual(ok.problems, []);

  const tampered = { ...first, prediction: "review" };
  const tamperCheck = await verifyReceipt(tampered);
  assert.equal(tamperCheck.status, "TAMPERED");
  assert.equal(tamperCheck.hashOk, false);

  // Valid hash but a verdict the pinned inputs do not support.
  const lying = await createReceipt({ ...input, verdict: "ESCALATE", path: "ESCALATE" });
  const lieCheck = await verifyReceipt(lying);
  assert.equal(lieCheck.status, "INCONSISTENT");
  assert.equal(lieCheck.hashOk, true);
  assert.equal(lieCheck.verdictOk, false);

  const malformed = await verifyReceipt({ kind: "something-else" });
  assert.equal(malformed.status, "MALFORMED");

  // Honest receipt under different thresholds: hash and verdict hold, flagged.
  const other = await createReceipt({
    ...input,
    thresholds: { autoConfidence: 0.9, maxEntropyBits: 6 },
    verdict: "ESCALATE",
    path: "ESCALATE",
  });
  const otherCheck = await verifyReceipt(other);
  assert.equal(otherCheck.status, "VERIFIED_OTHER_THRESHOLDS");
  assert.equal(otherCheck.hashOk, true);
  assert.equal(otherCheck.verdictOk, true);
  assert.equal(otherCheck.thresholdsMatchCommitted, false);
});

test("gate export: baked copy text executes against the kernel", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { selectGateTestCases, buildGateCopyText, buildGateCard } = await import("../lib/gate-export.ts");
  const { evaluateTriageGate } = await import("../lib/kernel.ts");

  const thresholds = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "evidence", "thresholds.json"), "utf8")
  );
  const captured = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "evidence", "captured-runs.json"), "utf8")
  );
  const calibration = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "evidence", "calibration.json"), "utf8")
  );
  const byId = new Map(captured.runs.map((r) => [r.id, r]));
  const heldRuns = calibration.split.heldoutIds.map((id) => byId.get(id));

  const cases = selectGateTestCases(heldRuns, {
    autoConfidence: thresholds.autoConfidence,
    maxEntropyBits: thresholds.maxEntropyBits,
  });
  assert.equal(cases.length, 3);
  assert.equal(new Set(cases.map((c) => c.id)).size, 3);
  for (const c of cases) {
    const decision = evaluateTriageGate(
      { id: c.id, probabilities: c.probabilities, entropyBits: c.entropyBits },
      { autoConfidence: thresholds.autoConfidence, maxEntropyBits: thresholds.maxEntropyBits }
    );
    assert.equal(decision.auto, c.expect === "AUTO", `${c.id}: embedded expectation matches the kernel`);
  }

  const src = buildGateCopyText({
    modelId: captured.modelId,
    decider: captured.decider,
    thresholds: { autoConfidence: thresholds.autoConfidence, maxEntropyBits: thresholds.maxEntropyBits },
    cases,
  });
  assert.match(src, /AUTO_CONFIDENCE = 0\.5/);
  assert.match(src, /MAX_ENTROPY_BITS = 6/);

  const exported = new Function(`${src}; return { triageGate, GATE_TESTS };`)();
  assert.equal(exported.GATE_TESTS.length, 3);
  for (const t of exported.GATE_TESTS) {
    const got = exported.triageGate(t.probabilities, t.entropyBits);
    assert.equal(got.verdict, t.expect, `${t.id}: pasted gate agrees with the kernel`);
  }
  const malformed = { refund: 0.5, review: 0.15, reject: 0.05 };
  assert.equal(exported.triageGate(malformed, 1).verdict, "ESCALATE");
  assert.equal(
    evaluateTriageGate(
      { id: "x", probabilities: malformed, entropyBits: 1 },
      { autoConfidence: thresholds.autoConfidence, maxEntropyBits: thresholds.maxEntropyBits }
    ).verdict,
    "ESCALATE"
  );

  const card = buildGateCard({
    modelId: calibration.modelId,
    dtype: calibration.dtype,
    decider: captured.decider,
    thresholds: { autoConfidence: thresholds.autoConfidence, maxEntropyBits: thresholds.maxEntropyBits },
    seed: calibration.seed,
    calibrationSize: calibration.split.calibrationSize,
    heldoutSize: calibration.split.heldoutSize,
    heldout: calibration.gate.heldout,
    calibratedAt: calibration.generatedAt,
    syntheticDataNote: calibration.syntheticDataNote,
    labelCount: Object.keys(captured.runs[0].probabilities).length,
    totalItems: captured.total,
  });
  assert.equal(card.modelId, calibration.modelId);
  assert.deepEqual(card.thresholds, calibration.gate.thresholds);
  assert.equal(card.heldoutReport.accuracyAtCoverage, calibration.gate.heldout.accuracyAtCoverage);
  assert.equal(card.heldoutReport.wrongAutoActions, calibration.gate.heldout.wrongAutoActions);
  assert.equal(card.calibratedAt, calibration.generatedAt);
});

test("calibrate: shared split, thresholds, and reports", async () => {
  const {
    CALIBRATION_SEED,
    MIN_CALIBRATION_ITEMS,
    accuracyOf,
    gateReport,
    pickThresholds,
    seededSplit,
  } = await import("../lib/calibrate.ts");

  assert.equal(CALIBRATION_SEED, 42);
  assert.equal(MIN_CALIBRATION_ITEMS, 20);

  const items = [
    { id: "a", confidence: 0.9, entropyBits: 4.0, correct: true },
    { id: "b", confidence: 0.8, entropyBits: 4.0, correct: true },
    { id: "c", confidence: 0.4, entropyBits: 4.0, correct: false },
    { id: "d", confidence: 0.3, entropyBits: 4.0, correct: true },
  ];
  const splitA = seededSplit(items, CALIBRATION_SEED);
  const splitB = seededSplit(items, CALIBRATION_SEED);
  assert.deepEqual(
    splitA.calibration.map((r) => r.id).sort(),
    splitB.calibration.map((r) => r.id).sort()
  );
  assert.equal(splitA.calibration.length, 2);
  assert.equal(splitA.heldout.length, 2);
  assert.deepEqual(
    [...splitA.calibration, ...splitA.heldout].map((r) => r.id).sort(),
    ["a", "b", "c", "d"]
  );

  // Best accuracy (1.0) at widest coverage (a, b): lowest bar, loosest entropy.
  assert.deepEqual(pickThresholds(items), { autoConfidence: 0.5, maxEntropyBits: 99 });
  assert.equal(pickThresholds([]), null);
  assert.equal(accuracyOf([]), 0);

  assert.deepEqual(gateReport(items, { autoConfidence: 0.5, maxEntropyBits: 99 }), {
    total: 4,
    autoHandled: 2,
    escalated: 2,
    coverage: 0.5,
    accuracyAtCoverage: 1,
    wrongAutoActions: 0,
    baselineAccuracy: 0.75,
    baselineWrong: 1,
  });
});

test("calibrate: user item parsers accept JSON and CSV, reject bad labels", async () => {
  const { parseLabelledItemsJson, parseLabelledItemsCsv, DeciderError } = await import("../lib/decider.ts");
  const labels = ["refund", "review", "reject"];

  const fromJson = parseLabelledItemsJson(
    JSON.stringify([
      { text: "charged twice", label: "refund" },
      { text: "where is my order", gold: "review" },
    ]),
    labels
  );
  assert.deepEqual(fromJson, [
    { text: "charged twice", gold: "refund" },
    { text: "where is my order", gold: "review" },
  ]);

  const fromCsv = parseLabelledItemsCsv('text,label\n"hello, world",review\n"give it back",refund', labels);
  assert.deepEqual(fromCsv, [
    { text: "hello, world", gold: "review" },
    { text: "give it back", gold: "refund" },
  ]);

  assert.throws(() => parseLabelledItemsJson(JSON.stringify([{ text: "x", label: "maybe" }]), labels), DeciderError);
  assert.throws(() => parseLabelledItemsJson("not json", labels), DeciderError);
  assert.throws(() => parseLabelledItemsCsv("text,label\n,refund", labels), DeciderError);
  assert.throws(() => parseLabelledItemsCsv("text,wrong\nx,refund", labels), DeciderError);
  assert.throws(() => parseLabelledItemsCsv("only-one-line", labels), DeciderError);
});

test("landing: gate block and evidence cases come from evidence files", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { loadLanding } = await import("../lib/landing.ts");

  const thresholds = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "evidence", "thresholds.json"), "utf8")
  );
  const calibration = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "evidence", "calibration.json"), "utf8")
  );
  const d = loadLanding();

  assert.equal(d.gate.tau, thresholds.autoConfidence);
  assert.equal(d.gate.maxEntropyBits, thresholds.maxEntropyBits);
  assert.equal(d.gate.totalRuns, 100);
  assert.equal(d.gate.autoHeld, calibration.gate.heldout.autoHandled);
  assert.equal(d.gate.wrongHeld, calibration.gate.heldout.wrongAutoActions);
  assert.ok(d.cases.length >= 3, "landing shows the auto case, wrong autos, and escalations");
  assert.equal(d.featured?.state, "clear");
  const states = d.cases.map((c) => c.state).sort();
  assert.ok(states.includes("flagged") && states.includes("pending"), "failures and escalations stay visible");
  assert.ok(
    d.cases.every((c) => c.sources.some((s) => s.label === "evidence/captured-runs.json")),
    "every landing case cites its evidence run"
  );
  assert.ok(d.steps.length > 0 && d.steps.every((s) => s.say.length > 0));
});

test("local folder: validation, dtype pick, cache mapping", async () => {
  const {
    buildInventory,
    cacheKeyToFilename,
    createFolderCache,
    filesToFolderFiles,
    folderNameFor,
    normalizeFolderPath,
    validateFolder,
    LocalFolderError,
  } = await import("../lib/local-folder.ts");

  assert.equal(normalizeFolderPath("./onnx\\model_uint8.onnx"), "onnx/model_uint8.onnx");
  assert.equal(folderNameFor([{ webkitRelativePath: "smol/onnx/model_uint8.onnx", name: "model_uint8.onnx" }]), "smol");
  assert.equal(folderNameFor([{ name: "model_uint8.onnx" }]), "dropped-folder");

  const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
  const dropped = [
    { name: "config.json", size: 4, webkitRelativePath: "smol/config.json", arrayBuffer: async () => bytes },
    { name: "tokenizer.json", size: 4, webkitRelativePath: "smol/tokenizer.json", arrayBuffer: async () => bytes },
    {
      name: "tokenizer_config.json",
      size: 4,
      webkitRelativePath: "smol/tokenizer_config.json",
      arrayBuffer: async () => bytes,
    },
    {
      name: "model_uint8.onnx",
      size: 4,
      webkitRelativePath: "smol/onnx/model_uint8.onnx",
      arrayBuffer: async () => bytes,
    },
  ];
  const asFolderFiles = filesToFolderFiles(dropped);
  assert.deepEqual(
    asFolderFiles.map((f) => f.path),
    ["smol/config.json", "smol/tokenizer.json", "smol/tokenizer_config.json", "smol/onnx/model_uint8.onnx"]
  );
  const inv = buildInventory(asFolderFiles);
  const validation = validateFolder(inv);
  assert.equal(validation.weightsFile, "smol/onnx/model_uint8.onnx");
  assert.equal(validation.dtype, "uint8");

  // Missing tokenizer_config names exactly what is missing.
  const missing = buildInventory(
    filesToFolderFiles(dropped.filter((f) => f.name !== "tokenizer_config.json"))
  );
  assert.throws(() => validateFolder(missing), (e) => e instanceof LocalFolderError && /tokenizer_config\.json/.test(e.message));

  // No weights at all.
  assert.throws(
    () =>
      validateFolder(
        buildInventory(
          filesToFolderFiles(dropped.filter((f) => !f.name.endsWith(".onnx")))
        )
      ),
    /no usable onnx/
  );

  // Split external data is refused.
  const withData = new Map(inv);
  withData.set("smol/onnx/model_uint8.onnx_data", {
    path: "smol/onnx/model_uint8.onnx_data",
    size: 1,
    arrayBuffer: async () => bytes,
  });
  assert.throws(() => validateFolder(withData), /split.*onnx_data/);

  // bnb4 is refused.
  const bnb = buildInventory([
    { path: "m/config.json", size: 1, arrayBuffer: async () => bytes },
    { path: "m/tokenizer.json", size: 1, arrayBuffer: async () => bytes },
    { path: "m/tokenizer_config.json", size: 1, arrayBuffer: async () => bytes },
    { path: "m/onnx/model_bnb4.onnx", size: 1, arrayBuffer: async () => bytes },
  ]);
  assert.throws(() => validateFolder(bnb), /bitsandbytes/);

  // uint8 wins over fp16 when both are present.
  const both = buildInventory([
    { path: "m/config.json", size: 1, arrayBuffer: async () => bytes },
    { path: "m/tokenizer.json", size: 1, arrayBuffer: async () => bytes },
    { path: "m/tokenizer_config.json", size: 1, arrayBuffer: async () => bytes },
    { path: "m/onnx/model_fp16.onnx", size: 1, arrayBuffer: async () => bytes },
    { path: "m/onnx/model_uint8.onnx", size: 1, arrayBuffer: async () => bytes },
  ]);
  assert.equal(validateFolder(both).dtype, "uint8");

  // Cache key mapping: remote URL tail, plain path, and junk.
  assert.equal(
    cacheKeyToFilename("https://huggingface.co/local-folder/resolve/main/onnx/model_uint8.onnx"),
    "onnx/model_uint8.onnx"
  );
  assert.equal(cacheKeyToFilename("tokenizer.json"), "tokenizer.json");
  assert.equal(cacheKeyToFilename(undefined), null);
  assert.equal(cacheKeyToFilename(42), null);

  // Served bytes are exactly the dropped bytes; misses stay misses.
  const cache = createFolderCache(inv);
  const hit = await cache.match("https://huggingface.co/local-folder/resolve/main/smol/onnx/model_uint8.onnx");
  assert.ok(hit instanceof Response);
  assert.deepEqual(new Uint8Array(await hit.arrayBuffer()), new Uint8Array([1, 2, 3, 4]));
  assert.equal(await cache.match("https://huggingface.co/local-folder/resolve/main/onnx/model_fp16.onnx"), undefined);
  await cache.put();
});

test("models: registry, sizes, per-model thresholds, load errors", async () => {
  const {
    MODEL_PRESETS,
    dtypeArtifactFiles,
    explainLoadError,
    fetchModelSize,
    formatBytes,
    loadStoredThresholds,
    resolveModelThresholds,
    saveThresholdsForModel,
  } = await import("../lib/models.ts");

  assert.ok(MODEL_PRESETS.length >= 2, "picker needs at least two presets");
  assert.ok(MODEL_PRESETS.every((p) => /^[^/\s]+\/[^/\s]+$/.test(p.id) && p.dtype && p.short));

  assert.deepEqual(dtypeArtifactFiles("uint8"), [
    "onnx/model_uint8.onnx",
    "onnx/model_uint8.onnx_data",
    "tokenizer.json",
    "config.json",
    "tokenizer_config.json",
  ]);
  assert.equal(formatBytes(136314880), "130 MB");
  assert.equal(formatBytes(2048), "2.0 KB");
  assert.equal(formatBytes(-1), "size unknown");

  const committed = { modelId: "m135", autoConfidence: 0.5, maxEntropyBits: 6 };
  // Stored device thresholds win for their own model id.
  assert.deepEqual(
    resolveModelThresholds("m135", committed, { m135: { autoConfidence: 0.7, maxEntropyBits: 5 } }),
    { thresholds: { autoConfidence: 0.7, maxEntropyBits: 5 }, source: "stored" }
  );
  // Committed evidence applies to its own model only.
  assert.deepEqual(resolveModelThresholds("m135", committed, {}), {
    thresholds: { autoConfidence: 0.5, maxEntropyBits: 6 },
    source: "committed",
  });
  // Other models calibrate first; invalid stored entries are ignored.
  assert.deepEqual(resolveModelThresholds("m360", committed, {}), { thresholds: null, source: "none" });
  assert.deepEqual(resolveModelThresholds("m360", committed, { m360: { autoConfidence: 2 } }), {
    thresholds: null,
    source: "none",
  });

  // Storage helpers no-op outside the browser without throwing.
  assert.deepEqual(loadStoredThresholds(), {});
  saveThresholdsForModel("m", { autoConfidence: 0.5, maxEntropyBits: 6 });

  const heads = {
    "onnx/model_uint8.onnx": 100000000,
    "tokenizer.json": 2000000,
    "config.json": 1000,
    "tokenizer_config.json": 500,
  };
  const mockFetch = async (url, opts) => {
    assert.equal(opts?.method, "HEAD");
    const file = Object.keys(heads).find((f) => url.endsWith(`/${f}`));
    if (!file) return { status: 404, ok: false, headers: new Headers() };
    return { status: 200, ok: true, headers: new Headers({ "content-length": String(heads[file]) }) };
  };
  const size = await fetchModelSize("owner/model", "uint8", mockFetch);
  assert.equal(size.bytes, 102001500);
  assert.equal(size.partial, false);
  assert.match(size.text, /97\.3 MB/);

  const failing = async () => {
    throw new TypeError("fetch failed");
  };
  const offline = await fetchModelSize("owner/model", "uint8", failing);
  assert.equal(offline.partial, true);

  assert.match(explainLoadError(new Error("out of memory")), /out of memory/i);
  assert.match(explainLoadError(new Error("404 not found")), /not found/i);
  assert.match(explainLoadError(new TypeError("fetch failed")), /network|cross-origin/i);
  assert.match(explainLoadError(new Error("timed out")), /timed out/i);
});
