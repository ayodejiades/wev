/**
 * tools/reference.ts — Record reference-model labels as EVIDENCE (opt-in).
 *
 * Asks a hosted OpenAI-compatible model to label every item in
 * `data/items.json` independently of the author's gold labels, then writes
 * `evidence/reference-labels.json`: provider, model id, the exact system
 * prompt, the sha256 of the items file it read, and the agreement rate between
 * the two labellers.
 *
 * What the agreement number means: two labellers agreeing. It is NOT accuracy
 * against truth — the author's labels are synthetic (data/items.json).
 *
 * The API key is read from the environment only. It is never written to the
 * evidence file, never logged, and never placed in a URL. With no key this
 * script exits 2 and writes nothing: the whole app is designed to build, test
 * and demo with `evidence/reference-labels.json` absent.
 *
 * Usage: pnpm reference   (needs REFERENCE_API_KEY and REFERENCE_MODEL)
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TRIAGE_DECIDER } from "../lib/decider.js";
import {
  buildReferenceMessages,
  labelWithReference,
  summarizeReference,
  ReferenceError,
} from "../lib/reference.js";

const itemsPath = path.join(process.cwd(), "data", "items.json");
const outPath = process.env.REFERENCE_OUT ?? path.join(process.cwd(), "evidence", "reference-labels.json");

const apiKey = process.env.REFERENCE_API_KEY ?? "";
const model = process.env.REFERENCE_MODEL ?? "";
const baseUrl = (process.env.REFERENCE_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");

async function main() {
  if (!apiKey.trim() || !model.trim()) {
    console.error("reference BLOCKED: set REFERENCE_API_KEY and REFERENCE_MODEL");
    process.exit(2);
  }
  if (!fs.existsSync(itemsPath)) {
    console.error(`reference FAILED: ${itemsPath} missing`);
    process.exit(1);
  }
  const itemsBytes = fs.readFileSync(itemsPath);
  const itemsSha256 = crypto.createHash("sha256").update(itemsBytes).digest("hex");
  const doc = JSON.parse(itemsBytes.toString("utf8")) as {
    items: Array<{ id: string; text: string; gold: string }>;
  };

  console.log(
    `reference: labelling ${doc.items.length} items with ${model} at ${new URL(baseUrl).hostname} (key read from env, never stored)`
  );

  let labeled;
  try {
    labeled = await labelWithReference(
      { baseUrl, model: model.trim(), apiKey: apiKey.trim() },
      TRIAGE_DECIDER,
      doc.items.map((i) => ({ id: i.id, text: i.text })),
      { concurrency: 4 }
    );
  } catch (e) {
    // Never write partial evidence: a half-labelled file would read as a claim.
    if (e instanceof ReferenceError) {
      console.error(`reference FAILED: ${e.message}`);
    } else {
      console.error("reference FAILED:", e);
    }
    process.exit(1);
  }

  const gold = doc.items.map((i) => ({ id: i.id, gold: i.gold }));
  const agreementWithGold = summarizeReference(labeled, gold);
  const goldById = new Map(gold.map((g) => [g.id, g.gold]));

  const payload = {
    provider: new URL(baseUrl).hostname,
    model: model.trim(),
    baseUrl,
    decider: `${TRIAGE_DECIDER.name}@${TRIAGE_DECIDER.version}`,
    systemPrompt: buildReferenceMessages(TRIAGE_DECIDER, "")[0].content,
    itemsSha256,
    generatedAt: new Date().toISOString(),
    agreementWithGold,
    labels: labeled.map((l) => {
      const g = goldById.get(l.id) ?? "";
      return { id: l.id, label: l.label, gold: g, agrees: l.label === g };
    }),
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n");
  console.log(
    `reference: wrote evidence/reference-labels.json — ${agreementWithGold.agree}/${agreementWithGold.total} agree with the author's synthetic labels (${(agreementWithGold.rate * 100).toFixed(1)}%)`
  );
}

main().catch((e) => {
  console.error("reference FAILED:", e);
  process.exit(1);
});