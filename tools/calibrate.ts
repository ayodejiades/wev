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
import {
  CALIBRATION_SEED,
  MIN_CALIBRATION_ITEMS,
  accuracyOf,
  gateReport,
  pickThresholds,
  seededSplit,
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

async function main() {
  const runsPath = process.env.CALIBRATE_IN ?? path.join(process.cwd(), "evidence", "captured-runs.json");
  const thresholdsPath = process.env.THRESHOLDS_OUT ?? path.join(process.cwd(), "evidence", "thresholds.json");
  const calibrationPath =
    process.env.CALIBRATION_OUT ?? path.join(process.cwd(), "evidence", "calibration.json");
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
  };

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
}

main().catch((e) => {
  console.error("calibrate FAILED:", e);
  process.exit(1);
});
