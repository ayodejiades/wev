/**
 * tools/make-reference-fixture.ts — write a TEST reference-labels.json into
 * evidence/ for the scripted reference-present browser run (Fix 8).
 *
 * This is NOT a model run and must never be treated as evidence: the labels are
 * a deterministic function of data/items.json (label = gold, except every 5th
 * item takes the next label in ["refund","review","reject"]). It exists so the
 * reference-present UI path can be exercised honestly end to end, and it is
 * deleted again by tools/e2e-reference.sh's trap.
 *
 * The output path defaults to evidence/reference-labels.json; pass one to write
 * somewhere else (e.g. to inspect the fixture without touching evidence/).
 *
 * Usage: node --import tsx tools/make-reference-fixture.ts [outPath]
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TRIAGE_DECIDER } from "../lib/decider.js";
import { buildReferenceMessages, summarizeReference } from "../lib/reference.js";

const ROOT = process.cwd();
const itemsPath = path.join(ROOT, "data", "items.json");
const outPath = process.argv[2] ?? path.join(ROOT, "evidence", "reference-labels.json");

const itemsBytes = fs.readFileSync(itemsPath);
const items = JSON.parse(itemsBytes.toString("utf8")) as { items: Array<{ id: string; text: string; gold: string }> };
const labels = TRIAGE_DECIDER.labels;

const rows = items.items.map((item, index) => {
  const label = index % 5 === 4 ? labels[(labels.indexOf(item.gold) + 1) % labels.length] : item.gold;
  return { id: item.id, label, gold: item.gold, agrees: label === item.gold };
});

const payload = {
  provider: "test-fixture",
  model: "test-fixture-model",
  baseUrl: "https://test-fixture.invalid/v1",
  decider: `${TRIAGE_DECIDER.name}@${TRIAGE_DECIDER.version}`,
  systemPrompt: buildReferenceMessages(TRIAGE_DECIDER, "")[0].content,
  itemsSha256: crypto.createHash("sha256").update(itemsBytes).digest("hex"),
  generatedAt: new Date().toISOString(),
  syntheticFixture: true,
  agreementWithGold: summarizeReference(rows, items.items.map((i) => ({ id: i.id, gold: i.gold }))),
  labels: rows,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n");
console.log(
  `reference fixture: ${rows.length} rows -> ${path.relative(ROOT, outPath)} (agreement ${payload.agreementWithGold.agree}/${payload.agreementWithGold.total})`
);