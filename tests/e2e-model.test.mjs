// tests/e2e-model.test.mjs — opt-in proof that the in-browser model really runs
// and that its scores match the committed Node run.
//
// This one needs ~130MB from the Hugging Face CDN, so it is NOT part of
// `pnpm test` or `pnpm test:e2e`: run it on purpose with
//   E2E_MODEL=1 pnpm test:e2e:model
// Without that variable it exits 0 immediately (A9.5) so nobody's CI hangs on a
// large download.
//
// What it establishes:
//   A9.1 the weights load in a real browser and 30 items get scored;
//   A9.2 browser predictions agree with evidence/captured-runs.json (>= 9/10,
//        confidence within 0.02 on agreeing rows) — the result is written to
//        evidence/browser-parity.json either way;
//   A9.3 after the first load the page works with the network blocked;
//   A9.4 a missing model file shows the plain "not found" error and the preset
//        is delisted instead of retried.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

if (process.env.E2E_MODEL !== "1") {
  console.log("model e2e skipped (set E2E_MODEL=1)");
  process.exit(0);
}

const PORT = Number(process.env.E2E_MODEL_PORT ?? 3112);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = process.cwd();
// A9.1 allows 10 minutes for the first load of ~130MB on a loaded machine.
const LOAD_TIMEOUT_MS = 10 * 60 * 1000;
const OFFLINE_TIMEOUT_MS = 3 * 60 * 1000;
const PARITY_FILE = path.join(ROOT, "evidence", "browser-parity.json");

const items = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "items.json"), "utf8")).items.slice(0, 30);
const captured = JSON.parse(fs.readFileSync(path.join(ROOT, "evidence", "captured-runs.json"), "utf8"));
const capturedById = new Map(captured.runs.map((r) => [r.id, r]));
const CSV = ["text,label", ...items.map((i) => `"${i.text.replace(/"/g, '""')}",${i.gold}`)].join("\n");

let server;
let browser;
let context;
let userProfile;
const pageErrors = [];
const weightResponses = [];

async function waitForHealth(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.status === 200) return res.json();
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`server did not answer on ${BASE} within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

function watch(page) {
  page.on("pageerror", (e) => pageErrors.push(`pageerror: ${e.message}`));
  page.on("response", (res) => {
    const url = res.url();
    const host = new URL(url).hostname;
    if (host.includes("huggingface.co") || host.includes("jsdelivr.net")) {
      weightResponses.push({ status: res.status(), url });
    }
  });
}

/** Run the 30 items on /calibrate with the given preset and wait for the rows. */
async function scoreThirty(page, timeoutMs) {
  await page.goto(`${BASE}/calibrate`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid='model-preset-135m']", { timeout: 30000 });
  await page.click("[data-testid='model-preset-135m']");
  await page.fill("textarea", CSV);
  await page.click("text=Check items");
  await page.waitForSelector("text=Found 30 labelled items.", { timeout: 30000 });
  await page.click("[data-testid='run-button']");
  await page.waitForFunction(
    () => {
      const line = document.querySelector("[data-testid='status-line']");
      return line !== null && /scoring on device/.test(line.textContent ?? "");
    },
    null,
    { timeout: timeoutMs }
  );
  await page.waitForFunction(() => document.querySelectorAll("[data-testid='results-row']").length === 30, null, {
    timeout: timeoutMs,
  });
}

/** prediction + confidence from a rendered row's text (computed, never hardcoded). */
function parseRow(text) {
  const prediction = /predicted\s+(\w+)/.exec(text)?.[1] ?? null;
  const confidence = /confidence\s+([\d.]+)%/.exec(text)?.[1];
  return { prediction, confidence: confidence === undefined ? null : Number(confidence) / 100 };
}

before(async () => {
  // DEMO_MODE unset on purpose: this must exercise the real model path.
  server = spawn("pnpm", ["start", "-p", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, DEMO_MODE: "", NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", () => {});
  server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  await waitForHealth();
  browser = await chromium.launch();
  // A persistent profile keeps the HTTP cache across reloads (A9.3).
  userProfile = fs.mkdtempSync(path.join(os.tmpdir(), "wev-model-profile-"));
  context = await browser.launchPersistentContext(userProfile, { viewport: { width: 1440, height: 1000 } });
});

after(async () => {
  await context?.close();
  await browser?.close();
  if (server && !server.killed) {
    server.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    if (!server.killed) server.kill("SIGKILL");
  }
  if (userProfile) fs.rmSync(userProfile, { recursive: true, force: true });
});

test("A9.1 + A9.2 the weights load in a real browser and match the committed Node run", async () => {
  const page = await context.newPage();
  watch(page);
  const started = Date.now();
  await scoreThirty(page, LOAD_TIMEOUT_MS);
  assert.deepEqual(pageErrors, [], pageErrors.join("\n"));

  const ok = weightResponses.filter(
    (r) => r.host === undefined && r.status === 200 && /\.(onnx|onnx_data)(\?|$)/.test(r.url)
  );
  assert.ok(
    ok.length > 0,
    `no 200 response for an .onnx weight: ${JSON.stringify(weightResponses.slice(0, 8))}`
  );

  // Parity: rows are u-0..u-29 in the order of data/items.json, so row i is
  // compared with the captured run for items[i].id.
  const rows = await page.locator("[data-testid='results-row']").allInnerTexts();
  assert.equal(rows.length, 30);
  const deltas = [];
  let matched = 0;
  const compared = [];
  for (let i = 0; i < 10; i++) {
    const run = capturedById.get(items[i].id);
    if (!run) continue;
    const { prediction, confidence } = parseRow(rows[i]);
    assert.equal(prediction !== null, true, `row ${i} has no prediction: ${rows[i].slice(0, 120)}`);
    const same = prediction === run.prediction;
    compared.push({ id: run.id, browser: prediction, node: run.prediction, same });
    if (same) {
      matched++;
      assert.ok(confidence !== null, `row ${i} has no confidence`);
      deltas.push(Math.abs(confidence - run.confidence));
    }
  }
  const maxDelta = deltas.length ? Math.round(Math.max(...deltas) * 10000) / 10000 : null;
  const report = {
    matched,
    total: compared.length,
    maxConfidenceDelta: maxDelta,
    generatedAt: new Date().toISOString(),
    userAgent: await page.evaluate(() => navigator.userAgent),
    note:
      "Browser (WASM) vs Node parity on the first 10 items: predictions must match on >= 9/10 and, where they agree, the displayed confidence must be within 0.02. Recorded whether it passed or failed; never loosened to pass.",
    rows: compared,
    loadSeconds: Math.round((Date.now() - started) / 1000),
  };
  fs.writeFileSync(PARITY_FILE, JSON.stringify(report, null, 2) + "\n");

  assert.ok(
    matched >= 9,
    `browser predictions matched only ${matched}/${compared.length}: ${JSON.stringify(compared)}`
  );
  for (const d of deltas) {
    assert.ok(d <= 0.02, `confidence drifted by ${d} (> 0.02) on an agreeing row`);
  }
  await page.close();
});

test("A9.3 after the first load the same run works with the network blocked", async () => {
  const page = await context.newPage();
  watch(page);
  await context.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === "127.0.0.1" || host === "localhost") return route.continue();
    return route.abort();
  });
  try {
    await scoreThirty(page, OFFLINE_TIMEOUT_MS);
    assert.equal(
      await page.locator("[data-testid='results-row']").count(),
      30,
      "the cached weights must be enough to score 30 items offline"
    );
    assert.deepEqual(pageErrors, [], pageErrors.join("\n"));
  } finally {
    await context.unroute("**/*");
  }
  await page.close();
});

test("A9.4 a model whose files are missing shows a plain error and is delisted", async () => {
  const page = await context.newPage();
  watch(page);
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.includes("huggingface.co") && /\.(onnx|onnx_data|json)(\?|$)/.test(url)) {
      return route.fulfill({ status: 404, body: "not found" });
    }
    return route.continue();
  });
  try {
    await page.goto(`${BASE}/calibrate`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-testid='model-preset-135m']", { timeout: 30000 });
    await page.click("[data-testid='model-preset-135m']");
    await page.fill("textarea", CSV);
    await page.click("text=Check items");
    await page.waitForSelector("text=Found 30 labelled items.", { timeout: 30000 });
    await page.click("[data-testid='run-button']");
    await page.waitForSelector("[data-testid='error-line']", { timeout: 120000 });
    const text = await page.locator("body").innerText();
    assert.match(text, /not found/i, text.slice(0, 400));
    // The failed preset is removed for the session, never retried silently.
    await page.waitForSelector("text=removed: it failed to load", { timeout: 30000 });
    assert.deepEqual(pageErrors, [], pageErrors.join("\n"));
  } finally {
    await page.unroute("**/*");
  }
  await page.close();
});