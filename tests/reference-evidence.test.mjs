// tests/reference-evidence.test.mjs — the gate scored against TWO label sources.
//
// Every test runs the real tools inside a throwaway copy of the repo (lib,
// tools, evidence, data) so the committed evidence/ is never touched and a
// mutated items.json can be tested honestly.
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();

/** Throwaway repo copy: real tools, real committed inputs, disposable outputs. */
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wev-evidence-"));
  for (const sub of ["lib", "tools", "evidence", "data"]) {
    fs.cpSync(path.join(ROOT, sub), path.join(dir, sub), { recursive: true });
  }
  fs.copyFileSync(path.join(ROOT, "package.json"), path.join(dir, "package.json"));
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"), "dir");
  return dir;
}

async function runTool(dir, script) {
  try {
    const { stdout, stderr } = await execFileAsync(
      path.join(ROOT, "node_modules", ".bin", "tsx"),
      [script],
      { cwd: dir, env: { ...process.env } }
    );
    return { code: 0, stdout, stderr };
  } catch (e) {
    return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? String(e) };
  }
}

function sha256File(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

/** Deterministic reference labels: gold, except every 5th item takes the next label. */
function writeReferenceFixture(dir, model = "sandbox-reference-model") {
  const itemsPath = path.join(dir, "data", "items.json");
  const items = JSON.parse(fs.readFileSync(itemsPath, "utf8")).items;
  const labels = ["refund", "review", "reject"];
  const rows = items.map((it, i) => {
    const label = i % 5 === 4 ? labels[(labels.indexOf(it.gold) + 1) % labels.length] : it.gold;
    return { id: it.id, label, gold: it.gold, agrees: label === it.gold };
  });
  const agree = rows.filter((r) => r.agrees).length;
  const doc = {
    provider: "sandbox",
    model,
    baseUrl: "https://sandbox.invalid/v1",
    decider: "support-ticket-triage@triage-v1",
    systemPrompt: "sandbox fixture",
    itemsSha256: sha256File(itemsPath),
    generatedAt: "2026-01-01T00:00:00.000Z",
    agreementWithGold: { agree, total: rows.length, rate: Math.round((agree / rows.length) * 10000) / 10000 },
    labels: rows,
  };
  const out = path.join(dir, "evidence", "reference-labels.json");
  fs.writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
  return out;
}

test("A3.1 calibrate scores the same seeded split against the reference labels too", async () => {
  const dir = sandbox();
  try {
    writeReferenceFixture(dir);
    const res = await runTool(dir, "tools/calibrate.ts");
    assert.equal(res.code, 0, `${res.stdout}${res.stderr}`);
    const calib = JSON.parse(fs.readFileSync(path.join(dir, "evidence", "calibration.json"), "utf8"));
    assert.ok(calib.referenceCheck, "referenceCheck must be written when a reference file exists");
    const rc = calib.referenceCheck;
    assert.equal(rc.referenceModel, "sandbox-reference-model");
    assert.equal(rc.heldoutVsGold.total, calib.split.heldoutSize);
    assert.equal(rc.heldoutVsReference.total, calib.split.heldoutSize);
    assert.equal(rc.goldAgreement.total, calib.split.calibrationSize + calib.split.heldoutSize);
    assert.deepEqual(rc.thresholdsAgreeOnVerdicts, {
      same: calib.split.heldoutSize,
      total: calib.split.heldoutSize,
    });
    // The vs-reference report must be an independently computed number, not a copy.
    assert.deepEqual(
      Object.keys(rc.heldoutVsReference).sort(),
      Object.keys(calib.gate.heldout).sort()
    );
    assert.match(res.stdout, /reference sandbox-reference-model agrees with author gold/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("A3.2 a reference file from different items is stale, and calibrate refuses", async () => {
  const dir = sandbox();
  try {
    writeReferenceFixture(dir);
    const itemsPath = path.join(dir, "data", "items.json");
    const doc = JSON.parse(fs.readFileSync(itemsPath, "utf8"));
    doc.items[0].text = `${doc.items[0].text} `; // one byte: items changed, reference does not
    fs.writeFileSync(itemsPath, JSON.stringify(doc, null, 2) + "\n");
    const res = await runTool(dir, "tools/calibrate.ts");
    assert.equal(res.code, 1);
    assert.match(`${res.stdout}${res.stderr}`, /calibrate FAILED: reference-labels\.json is stale \(items changed\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("A3.3 with no reference file, claim:verify passes and says so honestly", () => {
  assert.equal(fs.existsSync(path.join(ROOT, "evidence", "reference-labels.json")), false);
  const res = spawnSync("pnpm", ["claim:verify"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
  assert.match(res.stdout, /verify:evidence: PASS/);
  const md = fs.readFileSync(path.join(ROOT, "evidence", "verification.md"), "utf8");
  assert.ok(md.includes("REFERENCE: not recorded"), md);
});

test("A3.4 editing one reference label makes verify-evidence fail", async () => {
  const dir = sandbox();
  try {
    const refPath = writeReferenceFixture(dir);
    assert.equal((await runTool(dir, "tools/calibrate.ts")).code, 0);
    const ref = JSON.parse(fs.readFileSync(refPath, "utf8"));
    const target = ref.labels.find((l) => l.label !== l.gold) ?? ref.labels[0];
    target.label = target.label === "refund" ? "review" : "refund";
    target.agrees = target.label === target.gold;
    ref.agreementWithGold.agree = ref.labels.filter((l) => l.agrees).length;
    fs.writeFileSync(refPath, JSON.stringify(ref, null, 2) + "\n");
    const res = await runTool(dir, "tools/verify-evidence.ts");
    assert.equal(res.code, 1, "a tampered reference label must be caught");
    assert.match(`${res.stdout}${res.stderr}`, /verify:evidence FAILED: reference/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("A3.5 verify-evidence passes on an untouched reference run", async () => {
  const dir = sandbox();
  try {
    writeReferenceFixture(dir);
    assert.equal((await runTool(dir, "tools/calibrate.ts")).code, 0);
    const res = await runTool(dir, "tools/verify-evidence.ts");
    assert.equal(res.code, 0, `${res.stdout}${res.stderr}`);
    const md = fs.readFileSync(path.join(dir, "evidence", "verification.md"), "utf8");
    assert.match(md, /\| REFERENCE: independent label source \| PASS \|/);
    assert.ok(!md.includes("REFERENCE: not recorded"));
    // The manifest pins the reference file it verified.
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "evidence", "evidence-manifest.json"), "utf8"));
    assert.equal(manifest.files["reference-labels.json"], sha256File(path.join(dir, "evidence", "reference-labels.json")));
    assert.equal(manifest.referenceModel, "sandbox-reference-model");
    assert.equal(manifest.goldSource, "author-synthetic");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("A3.6 the evidence manifest is deterministic across runs", async () => {
  const dir = sandbox();
  try {
    writeReferenceFixture(dir);
    assert.equal((await runTool(dir, "tools/calibrate.ts")).code, 0);
    assert.equal((await runTool(dir, "tools/verify-evidence.ts")).code, 0);
    const manifestPath = path.join(dir, "evidence", "evidence-manifest.json");
    const first = fs.readFileSync(manifestPath, "utf8");
    assert.equal((await runTool(dir, "tools/verify-evidence.ts")).code, 0);
    assert.equal(fs.readFileSync(manifestPath, "utf8"), first, "manifest must be byte-stable");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});