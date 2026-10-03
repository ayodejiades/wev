/**
 * tools/calibrate.ts — Seeded calibration for the act-or-escalate gate.
 *
 * Reads evidence/captured-runs.json (real SmolLM2 runs from `pnpm capture`),
 * then runs the shared implementation in lib/calibrate.ts (seeded 50/50
 * split, threshold search on the first half, accuracy-at-coverage report on
 * the held-out half versus an always-trust baseline).
 *
 * Writes evidence/thresholds.json and evidence/calibration.json.
 * Every number is computed from captured runs; nothing is hardcoded.
 *
 * Usage: pnpm calibrate
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  CALIBRATION_SEED,
  MIN_CALIBRATION_ITEMS,
  accuracyOf,
  computeReferenceCheck,
  gateReport,
  pickThresholds,
  seededSplit,
  type ReferenceRun,
} from "../lib/calibrate.js";

interface Run {
  id: string;
  text: string;
  gold: string;
  probabilities: Record<string, number>;
  prediction: string;
  confidence: number;
  entropyBits: number;
  correct: boolean;
}

interface ReferenceFile {
  provider?: string;
  model: string;
  itemsSha256: string;
  labels: Array<{ id: string; label: string; gold: string; agrees: boolean }>;
}

/**
 * Load evidence/reference-labels.json when it exists (the OPTIONAL second label
 * source). Returns null when absent — the whole calibration, the evidence
 * files and the app are built to work without it. A file whose itemsSha256 no
 * longer matches data/items.json is stale and fatal: mixing labels from a
 * different item set would silently invent an agreement number.
 */
function loadReferenceFile(referencePath: string, itemsPath: string): ReferenceFile | null {
  if (!fs.existsSync(referencePath)) return null;
  const raw = fs.readFileSync(referencePath, "utf8");
  const itemsSha256 = crypto.createHash("sha256").update(fs.readFileSync(itemsPath)).digest("hex");
  const doc = JSON.parse(raw) as ReferenceFile;
  if (doc.itemsSha256 !== itemsSha256) {
    console.error("calibrate FAILED: reference-labels.json is stale (items changed)");
    process.exit(1);
  }
  if (!Array.isArray(doc.labels) || typeof doc.model !== "string") {
    console.error("calibrate FAILED: reference-labels.json is malformed (need model + labels[])");
    process.exit(1);
  }
  return doc;
}

async function main() {
  const runsPath = process.env.CALIBRATE_IN ?? path.join(process.cwd(), "evidence", "captured-runs.json");
  const thresholdsPath = process.env.THRESHOLDS_OUT ?? path.join(process.cwd(), "evidence", "thresholds.json");
  const calibrationPath =
    process.env.CALIBRATION_OUT ?? path.join(process.cwd(), "evidence", "calibration.json");
  const itemsPath = process.env.CALIBRATE_ITEMS_IN ?? path.join(process.cwd(), "data", "items.json");
  const referencePath =
    process.env.CALIBRATE_REFERENCE_IN ?? path.join(process.cwd(), "evidence", "reference-labels.json");
  if (!fs.existsSync(runsPath)) {
    console.error(`calibrate FAILED: ${runsPath} missing — run pnpm capture first`);
    process.exit(1);
  }
  const doc = JSON.parse(fs.readFileSync(runsPath, "utf8"));
  const runs = doc.runs as Run[];
  if (!Array.isArray(runs) || runs.length < MIN_CALIBRATION_ITEMS) {
    console.error(`calibrate FAILED: need >= ${MIN_CALIBRATION_ITEMS} captured runs, got ${runs?.length ?? 0}`);
    process.exit(1);
  }

  const { calibration: calib, heldout: held } = seededSplit(runs, CALIBRATION_SEED);

  const baselineCalib = accuracyOf(calib);
  const baselineHeld = accuracyOf(held);

  const best = pickThresholds(calib);

  // If nothing auto-handles (model never confident), report coverage 0 honestly.
  const thresholds = {
    modelId: doc.modelId,
    dtype: doc.dtype,
    seed: CALIBRATION_SEED,
    autoConfidence: best?.autoConfidence ?? 1.01,
    maxEntropyBits: best?.maxEntropyBits ?? 0,
    calibratedOn: calib.length,
    note:
      "AUTO iff confidence >= autoConfidence AND entropyBits <= maxEntropyBits, else ESCALATE. Picked on the calibration half only; held-out numbers are the honest report.",
  };

  const calibReport = gateReport(calib, {
    autoConfidence: thresholds.autoConfidence,
    maxEntropyBits: thresholds.maxEntropyBits,
  });
  const heldReport = gateReport(held, {
    autoConfidence: thresholds.autoConfidence,
    maxEntropyBits: thresholds.maxEntropyBits,
  });

  const calibration = {
    modelId: doc.modelId,
    dtype: doc.dtype,
    seed: CALIBRATION_SEED,
    split: {
      calibrationIds: calib.map((r) => r.id),
      heldoutIds: held.map((r) => r.id),
      calibrationSize: calib.length,
      heldoutSize: held.length,
    },
    baseline: {
      calibrationAccuracy: Math.round(baselineCalib * 10000) / 10000,
      heldoutAccuracy: Math.round(baselineHeld * 10000) / 10000,
    },
    gate: {
      thresholds: { autoConfidence: thresholds.autoConfidence, maxEntropyBits: thresholds.maxEntropyBits },
      calibration: calibReport,
      heldout: heldReport,
    },
    syntheticDataNote:
      "Gold labels are SYNTHETIC (data/items.json, hand-written). Accuracy numbers measure the gate on synthetic tickets with one small model, not real-world performance.",
    generatedAt: new Date().toISOString(),
    // Present only when evidence/reference-labels.json exists; JSON.stringify
    // drops an undefined value, so the file is byte-identical without it.
    referenceCheck: undefined as ReturnType<typeof computeReferenceCheck> | undefined,
  };

  // Optional second label source: score the SAME seeded split against the
  // reference model's labels too, so the held-out numbers are not resting on
  // one labeller's opinion alone. Absent file => byte-identical output to before.
  const reference = fs.existsSync(referencePath) ? loadReferenceFile(referencePath, itemsPath) : null;
  if (reference) {
    const referenceById = new Map(reference.labels.map((l) => [l.id, l.label]));
    const missing = runs.filter((r) => !referenceById.has(r.id)).map((r) => r.id);
    if (missing.length > 0) {
      console.error(
        `calibrate FAILED: reference-labels.json has no label for ${missing.length} captured run(s), first ${missing[0]}`
      );
      process.exit(1);
    }
    const withReference: ReferenceRun[] = runs.map((r) => ({
      id: r.id,
      confidence: r.confidence,
      entropyBits: r.entropyBits,
      correct: r.correct,
      prediction: r.prediction,
      gold: r.gold,
      referenceLabel: referenceById.get(r.id)!,
    }));
    const referenceSha256 = crypto
      .createHash("sha256")
      .update(fs.readFileSync(referencePath))
      .digest("hex");
    calibration.referenceCheck = computeReferenceCheck({
      heldout: withReference.filter((r) => held.some((h) => h.id === r.id)),
      allRuns: withReference,
      thresholds: { autoConfidence: thresholds.autoConfidence, maxEntropyBits: thresholds.maxEntropyBits },
      referenceModel: reference.model,
      referenceSha256,
    });
  }

  fs.mkdirSync(path.join(process.cwd(), "evidence"), { recursive: true });
  fs.writeFileSync(thresholdsPath, JSON.stringify(thresholds, null, 2) + "\n");
  fs.writeFileSync(calibrationPath, JSON.stringify(calibration, null, 2) + "\n");

  console.log(
    `calibrate: seed=${CALIBRATION_SEED} calib=${calib.length} held=${held.length} ` +
      `tau=${thresholds.autoConfidence} maxH=${thresholds.maxEntropyBits} ` +
      `heldout coverage=${(heldReport.coverage * 100).toFixed(1)}% ` +
      `acc@coverage=${(heldReport.accuracyAtCoverage * 100).toFixed(1)}% ` +
      `(baseline ${(heldReport.baselineAccuracy * 100).toFixed(1)}%, wrong auto=${heldReport.wrongAutoActions})`
  );
  if (calibration.referenceCheck) {
    const rc = calibration.referenceCheck;
    console.log(
      `calibrate: reference ${rc.referenceModel} agrees with author gold on ${rc.goldAgreement.agree}/${rc.goldAgreement.total} (${(rc.goldAgreement.rate * 100).toFixed(1)}%); held-out acc vs reference ${(rc.heldoutVsReference.accuracyAtCoverage * 100).toFixed(1)}% at ${(rc.heldoutVsReference.coverage * 100).toFixed(1)}% coverage; verdicts identical on ${rc.thresholdsAgreeOnVerdicts.same}/${rc.thresholdsAgreeOnVerdicts.total}`
    );
  }
}

main().catch((e) => {
  console.error("calibrate FAILED:", e);
  process.exit(1);
});
