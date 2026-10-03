// tests/receipt-evidence.test.mjs — receipts name the evidence they were issued
// against (v2), and v1 receipts keep verifying exactly as before.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const BASE_INPUT = {
  id: "T-001",
  input: "I was charged twice for $18, please give it back",
  modelId: "onnx-community/SmolLM2-135M-ONNX",
  deciderVersion: "triage-v1",
  probabilities: { refund: 0.8394, review: 0.1331, reject: 0.0275 },
  confidence: 0.8394,
  entropyBits: 5.5678,
  prediction: "refund",
  thresholds: { autoConfidence: 0.5, maxEntropyBits: 6 },
  verdict: "AUTO",
  path: "AUTO",
};

test("A4.1 a v1 receipt fixture still verifies", async () => {
  const { createReceipt, verifyReceipt, hashReceiptPayload, RECEIPT_VERSION } = await import(
    "../lib/receipt.ts"
  );
  assert.equal(RECEIPT_VERSION, 2);
  const current = await createReceipt(BASE_INPUT);
  assert.equal(current.version, 2);
  const { kind, gateVersion, sha256, evidence, ...body } = current;
  void kind;
  void gateVersion;
  void sha256;
  void evidence;
  const v1 = {
    kind: "wev-gate-receipt",
    version: 1,
    gateVersion: "wev-gate-v1",
    ...body,
    sha256: await hashReceiptPayload(body, 1),
  };
  assert.equal(v1.evidence, undefined, "the v1 fixture must have no evidence block");
  const check = await verifyReceipt(JSON.parse(JSON.stringify(v1)));
  assert.equal(check.status, "VERIFIED");
  assert.deepEqual(check.problems, []);
  assert.equal(check.hashOk, true);
  assert.equal(check.verdictOk, true);
});

test("A4.2 a v2 receipt verifies; any change to its evidence breaks the hash", async () => {
  const { createReceipt, verifyReceipt } = await import("../lib/receipt.ts");
  const good = await createReceipt(BASE_INPUT);
  assert.equal((await verifyReceipt(good)).status, "VERIFIED");
  assert.ok(good.evidence, "createReceipt must pin the evidence it was issued against");
  assert.equal(good.evidence.goldSource, "author-synthetic");
  assert.match(good.evidence.thresholdsSha256, /^[0-9a-f]{64}$/);
  assert.match(good.evidence.capturedRunsSha256, /^[0-9a-f]{64}$/);
  assert.equal(good.evidence.referenceSha256, null, "no reference evidence is committed yet");
  assert.equal(good.evidence.referenceModel, null);

  const flipped = JSON.parse(JSON.stringify(good));
  const first = flipped.evidence.thresholdsSha256[0];
  flipped.evidence.thresholdsSha256 = (first === "a" ? "b" : "a") + flipped.evidence.thresholdsSha256.slice(1);
  const check = await verifyReceipt(flipped);
  assert.equal(check.status, "TAMPERED");
  assert.equal(check.hashOk, false);
});

test("A4.3 a re-hashed receipt naming other evidence is VERIFIED_OTHER_THRESHOLDS, never VERIFIED", async () => {
  const { createReceipt, verifyReceipt, hashReceiptPayload } = await import("../lib/receipt.ts");
  const good = await createReceipt(BASE_INPUT);
  const forged = JSON.parse(JSON.stringify(good));
  forged.evidence.thresholdsSha256 = "0".repeat(64);
  const { sha256, ...body } = forged;
  void sha256;
  forged.sha256 = await hashReceiptPayload(body, 2);
  const check = await verifyReceipt(forged);
  assert.equal(check.hashOk, true, "the forged receipt is internally consistent");
  assert.equal(check.verdictOk, true);
  assert.equal(check.thresholdsMatchCommitted, true);
  assert.equal(check.evidenceMatchBuild, false);
  assert.equal(check.status, "VERIFIED_OTHER_THRESHOLDS");
  assert.ok(
    check.problems.includes("receipt was issued against different calibration evidence than this build"),
    check.problems.join(" | ")
  );
});

test("A4.4 an unknown receipt version is MALFORMED", async () => {
  const { createReceipt, verifyReceipt } = await import("../lib/receipt.ts");
  const good = await createReceipt(BASE_INPUT);
  const v3 = { ...good, version: 3 };
  const check = await verifyReceipt(v3);
  assert.equal(check.status, "MALFORMED");
  assert.equal(check.receipt, null);
  assert.match(check.problems.join(" "), /version is 3/);
});

test("A4.5 the gate card carries the same evidence block and reference model", async () => {
  const { buildGateCard } = await import("../lib/gate-export.ts");
  const { evidenceFromManifest } = await import("../lib/receipt.ts");
  const card = buildGateCard({
    modelId: "m",
    dtype: "uint8",
    decider: "d@v",
    thresholds: { autoConfidence: 0.5, maxEntropyBits: 6 },
    seed: 42,
    calibrationSize: 50,
    heldoutSize: 50,
    heldout: {
      coverage: 0.1,
      accuracyAtCoverage: 0.6,
      baselineAccuracy: 0.4,
      wrongAutoActions: 2,
      autoHandled: 5,
      total: 50,
    },
    calibratedAt: "2026-01-01T00:00:00.000Z",
    syntheticDataNote: "synthetic",
    labelCount: 3,
    totalItems: 100,
    evidence: evidenceFromManifest(),
  });
  assert.match(card.evidence.thresholdsSha256, /^[0-9a-f]{64}$/);
  assert.equal(card.referenceModel, null);
  const none = buildGateCard({
    modelId: "m",
    dtype: "uint8",
    decider: "d@v",
    thresholds: { autoConfidence: 0.5, maxEntropyBits: 6 },
    seed: 42,
    calibrationSize: 5,
    heldoutSize: 5,
    heldout: { coverage: 0, accuracyAtCoverage: 0, baselineAccuracy: 0, wrongAutoActions: 0, autoHandled: 0, total: 5 },
    calibratedAt: "2026-01-01T00:00:00.000Z",
    syntheticDataNote: "user items",
    labelCount: 3,
    totalItems: 30,
  });
  assert.equal(none.evidence, null);
  assert.equal(none.referenceModel, null);
});

test("A4.6 claim:verify regenerates evidence-manifest.json deterministically", () => {
  const manifestPath = path.join(process.cwd(), "evidence", "evidence-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.kind, "wev-evidence-manifest");
  execFileSync("pnpm", ["claim:verify"], { stdio: "pipe" });
  execFileSync("pnpm", ["claim:verify"], { stdio: "pipe" });
  const again = fs.readFileSync(manifestPath, "utf8");
  assert.equal(again, JSON.stringify(manifest, null, 2) + "\n", "manifest bytes must not move");
  // Only the human-readable timestamped ledgers may differ between runs.
  const diff = execFileSync("git", ["status", "--porcelain", "evidence/"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .filter((l) => !l.includes("verification.md") && !l.includes("campaign-report.md"));
  assert.deepEqual(diff, [], `unexpected evidence changes: ${diff.join(" | ")}`);
});