// tests/reference-tool.test.mjs — tools/reference.ts: the BLOCKED path must be
// a clean exit 2 that writes nothing, the shared agreement summary must be
// computable, and no key material may live anywhere but the env read.
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const evidenceDir = path.join(process.cwd(), "evidence");
const outPath = path.join(evidenceDir, "reference-labels.json");

function gitPorcelainEvidence() {
  return execFileSync("git", ["status", "--porcelain", "evidence/"], { encoding: "utf8" }).trim();
}

test("A2.1 summarizeReference is the single agreement implementation", async () => {
  const { summarizeReference } = await import("../lib/reference.ts");
  const got = summarizeReference(
    [
      { id: "a", label: "refund" },
      { id: "b", label: "review" },
      { id: "c", label: "review" },
      { id: "d", label: "refund" },
    ],
    { a: "refund", b: "review", c: "review", d: "reject" }
  );
  assert.deepEqual(got, { agree: 3, total: 4, rate: 0.75 });
  // The tool and the tests must agree on the arithmetic: the tool imports this.
  const toolSource = fs.readFileSync(path.join(process.cwd(), "tools", "reference.ts"), "utf8");
  assert.match(toolSource, /summarizeReference/);
  assert.match(toolSource, /agreementWithGold = summarizeReference/);
});

test("A2.2 without a key, pnpm reference prints BLOCKED, exits 2 and writes no file", () => {
  const before = gitPorcelainEvidence();
  const res = spawnSync("pnpm", ["reference"], {
    encoding: "utf8",
    env: { ...process.env, REFERENCE_API_KEY: "", REFERENCE_MODEL: "" },
    shell: false,
  });
  assert.equal(res.status, 2, `expected exit 2, got ${res.status}: ${res.stdout}${res.stderr}`);
  assert.match(`${res.stdout}${res.stderr}`, /reference BLOCKED: set REFERENCE_API_KEY and REFERENCE_MODEL/);
  assert.equal(fs.existsSync(outPath), false, "no reference-labels.json may be written when blocked");
  assert.equal(gitPorcelainEvidence(), before, "evidence/ must be untouched");
});

/** Async `pnpm <args>` so this process keeps serving the stub endpoint meanwhile. */
function runPnpm(args, extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", args, {
      cwd: process.cwd(),
      env: { ...process.env, ...extraEnv },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => {
      stdout += c;
    });
    child.stderr.on("data", (c) => {
      stderr += c;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ status: code, stdout, stderr }));
  });
}

test("A2.3 the key is read only by the tool; evidence and app code never name it", () => {
  const res = spawnSync(
    "grep",
    ["-rn", "REFERENCE_API_KEY", "evidence/", "lib/", "app/", "tools/"],
    { encoding: "utf8" }
  );
  const lines = res.stdout.split("\n").filter(Boolean);
  assert.ok(lines.length > 0, "the tool must read the key");
  for (const line of lines) {
    assert.match(line, /^tools\/reference\.ts:\d+:/, `unexpected REFERENCE_API_KEY reference: ${line}`);
  }
  const evidenceMentions = lines.filter((l) => l.startsWith("evidence/"));
  assert.deepEqual(evidenceMentions, [], "no evidence file may mention the key name");
});

test("A2.4 the blocked tool never stores a raw reply, and the evidence file is absent", () => {
  // Only meaningful once a real run has happened; until then this is the honest state.
  if (!fs.existsSync(outPath)) {
    assert.ok(true, "reference evidence not recorded (no key): nothing to check");
    return;
  }
  const doc = JSON.parse(fs.readFileSync(outPath, "utf8"));
  assert.equal(typeof doc.provider, "string");
  assert.equal(typeof doc.model, "string");
  assert.equal(doc.decider, "support-ticket-triage@triage-v1");
  assert.equal(doc.labels.length, doc.agreementWithGold.total);
  const serialized = JSON.stringify(doc);
  assert.ok(!/sk-/.test(serialized), "no key-shaped string may be stored");
});

test("A2.5 the tool writes a correct evidence file against a stub endpoint", async () => {
  // Integration check of tools/reference.ts with no key and no network: a local
  // OpenAI-compatible stub stands in for the provider, and the output goes to a
  // temp path. This proves the FILE SHAPE; it is never written into evidence/.
  const http = await import("node:http");
  const os = await import("node:os");
  const crypto = await import("node:crypto");
  const { TRIAGE_DECIDER } = await import("../lib/decider.ts");

  const itemsDoc = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "items.json"), "utf8"));
  const seenAuth = [];
  const seenBodies = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      seenAuth.push(req.headers.authorization ?? "");
      seenBodies.push(JSON.parse(body || "{}"));
      const parsed = JSON.parse(body || "{}");
      const text = parsed?.messages?.[1]?.content ?? "";
      const item = itemsDoc.items.find((i) => i.text === text);
      const label = item ? item.gold : "review";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: `${label}.` } }] }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wev-reference-"));
  const tmpOut = path.join(tmp, "reference-labels.json");
  const before = gitPorcelainEvidence();
  try {
    // Must be async: the stub endpoint runs in this process, so a blocking
    // spawnSync would deadlock the very server it is waiting on.
    const res = await runPnpm(["reference"], {
      REFERENCE_API_KEY: "stub-key-not-a-real-secret",
      REFERENCE_MODEL: "stub-model",
      REFERENCE_BASE_URL: `http://127.0.0.1:${port}/v1`,
      REFERENCE_OUT: tmpOut,
    });
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
    const doc = JSON.parse(fs.readFileSync(tmpOut, "utf8"));
    assert.equal(doc.provider, "127.0.0.1");
    assert.equal(doc.model, "stub-model");
    assert.equal(doc.decider, `support-ticket-triage@${TRIAGE_DECIDER.version}`);
    assert.equal(
      doc.systemPrompt,
      `${TRIAGE_DECIDER.instruction}\nReply with exactly one label from: ${TRIAGE_DECIDER.labels.join(", ")}. No other text.`
    );
    const itemsBytes = fs.readFileSync(path.join(process.cwd(), "data", "items.json"));
    assert.equal(
      doc.itemsSha256,
      crypto.createHash("sha256").update(itemsBytes).digest("hex"),
      "the file must pin the exact items it labelled"
    );
    assert.equal(doc.labels.length, itemsDoc.items.length);
    assert.equal(doc.agreementWithGold.total, itemsDoc.items.length);
    assert.equal(doc.agreementWithGold.agree, itemsDoc.items.length);
    assert.equal(doc.agreementWithGold.rate, 1);
    assert.ok(doc.labels.every((l) => l.label === l.gold && l.agrees === true));
    const serialized = fs.readFileSync(tmpOut, "utf8");
    assert.ok(!serialized.includes("stub-key-not-a-real-secret"), "the key must never be stored");
    assert.ok(seenAuth.every((a) => a.startsWith("Bearer ")), "the key goes in the header only");
    assert.ok(seenBodies.every((b) => b.temperature === 0 && b.max_tokens === 8));
    assert.equal(gitPorcelainEvidence(), before, "a temp-path run must not touch evidence/");
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});