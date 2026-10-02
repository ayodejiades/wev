/**
 * tools/capture.ts — Capture real SmolLM2 runs for the act-or-escalate gate.
 *
 * Runs onnx-community/SmolLM2-135M-ONNX (uint8) in Node via
 * @huggingface/transformers, scoring the TRIAGE_DECIDER closed label set
 * through the shared Decider code in lib/decider.ts (the same
 * `buildDeciderPrompt` + full-sequence scoring the live UI uses, so captured
 * runs and the browser cannot diverge). Writes per-item probabilities +
 * full-vocabulary entropy to evidence/captured-runs.json.
 *
 * Scoring (closed set, no top-5 renormalization):
 * - Full-sequence log-probability per label, softmaxed over the label set.
 * - Full-vocabulary softmax gives entropyBits (honest uncertainty).
 * - prediction = argmax, confidence = max probability, correct = prediction === gold.
 *
 * Usage: pnpm capture
 */
import fs from "node:fs";
import path from "node:path";
import { AutoTokenizer, AutoModelForCausalLM, Tensor } from "@huggingface/transformers";
import {
  TRIAGE_DECIDER,
  buildDeciderPrompt,
  createLogitsAdapter,
  decide,
} from "../lib/decider.js";

const MODEL_ID = process.env.MODEL_ID ?? "onnx-community/SmolLM2-135M-ONNX";
const DTYPE = "uint8";
const OUT_PATH = process.env.CAPTURE_OUT ?? path.join(process.cwd(), "evidence", "captured-runs.json");

interface ItemRow {
  id: string;
  text: string;
  gold: string;
}

async function main() {
  const itemsPath = path.join(process.cwd(), "data", "items.json");
  if (!fs.existsSync(itemsPath)) {
    console.error("capture FAILED: data/items.json missing");
    process.exit(1);
  }
  const itemsDoc = JSON.parse(fs.readFileSync(itemsPath, "utf8"));
  const rows = itemsDoc.items as ItemRow[];
  if (!Array.isArray(rows) || rows.length === 0) {
    console.error("capture FAILED: data/items.json has no items");
    process.exit(1);
  }

  console.log(`capture: loading tokenizer ${MODEL_ID}`);
  const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
  console.log(`capture: loading model ${MODEL_ID} (dtype=${DTYPE}, first run downloads weights)`);
  const model = await AutoModelForCausalLM.from_pretrained(MODEL_ID, { dtype: DTYPE });
  console.log("capture: model loaded (decider triage-v1 via shared lib/decider.ts)");

  // TensorImpl is injected from this module's own imports so hand-built prefix
  // Tensors are instances of the exact class the model was built with.
  const adapter = createLogitsAdapter({ tokenizer, model, modelId: MODEL_ID, TensorImpl: Tensor as never });

  const runs: Array<{
    id: string;
    text: string;
    gold: string;
    prompt: string;
    probabilities: Record<string, number>;
    prediction: string;
    confidence: number;
    entropyBits: number;
    correct: boolean;
  }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const output = await decide(adapter, TRIAGE_DECIDER, row.text);
    if (output.entropyBits === null) {
      console.error(`capture FAILED: no full-vocabulary entropy for ${row.id}`);
      process.exit(1);
    }
    runs.push({
      id: row.id,
      text: row.text,
      gold: row.gold,
      prompt: buildDeciderPrompt(TRIAGE_DECIDER, row.text),
      probabilities: output.probabilities,
      prediction: output.value,
      confidence: output.confidence,
      entropyBits: output.entropyBits,
      correct: output.value === row.gold,
    });

    if ((i + 1) % 10 === 0 || i + 1 === rows.length) {
      const acc = runs.filter((r) => r.correct).length / runs.length;
      console.log(`capture: ${i + 1}/${rows.length} (running accuracy ${(acc * 100).toFixed(1)}%)`);
    }
  }

  const correct = runs.filter((r) => r.correct).length;
  const doc = {
    modelId: MODEL_ID,
    dtype: DTYPE,
    decider: `${TRIAGE_DECIDER.name}@${TRIAGE_DECIDER.version}`,
    promptTemplate: buildDeciderPrompt(TRIAGE_DECIDER, "<TEXT>"),
    scoring:
      "closed label set (refund/review/reject) via full-sequence log-probabilities from lib/decider.ts, softmax over the label set only; no top-5 renormalization; full-vocabulary softmax for entropyBits",
    limitation:
      "Single small model (SmolLM2-135M-ONNX uint8), one few-shot prompt, one closed task. Shared-prefix labels are handled by full-sequence scoring in lib/decider.ts.",
    syntheticDataNote:
      "Gold labels are SYNTHETIC, hand-written in data/items.json by the author, not human-annotated real tickets.",
    generatedAt: new Date().toISOString(),
    accuracy: Math.round((correct / runs.length) * 10000) / 10000,
    correct,
    total: runs.length,
    runs,
  };

  const outPath = OUT_PATH;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n");
  console.log(
    `capture: wrote ${outPath} (${correct}/${runs.length} correct, accuracy ${(doc.accuracy * 100).toFixed(1)}%)`
  );
}

main().catch((e) => {
  console.error("capture FAILED:", e);
  process.exit(1);
});
