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
let context;
let userProfile;
let serverExit = null;
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

/**
 * Weight hosts: the Hub itself, its LFS CDN (cdn-lfs*.hf.co — a different
 * hostname, and where the actual .onnx bytes are served from), and jsDelivr for
 * the transformers.js runtime.
 */
const WEIGHT_HOSTS = ["huggingface.co", "hf.co", "jsdelivr.net"];
function isWeightHost(host) {
  return WEIGHT_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

function watch(page) {
  page.on("pageerror", (e) => pageErrors.push(`pageerror: ${e.message}`));
  page.on("response", (res) => {
    const url = res.url();
    if (isWeightHost(new URL(url).hostname)) weightResponses.push({ status: res.status(), url });
  });
}

/** Every progress line the status bar showed, so the load is visible in the log. */
const progressSeen = new Set();
async function trackStatus(page) {
  const line = page.locator("[data-testid='status-line']");
  if ((await line.count()) === 0) return "(gone)";
  const text = await line.innerText();
  progressSeen.add(text);
  return text;
}

/**
 * Run the 30 items on /calibrate and wait for the scoring to finish.
 *
 * Waits on the RESULT (30 rows) or an error line, never on the transient
 * "scoring on device" text: on a warm cache the whole scoring pass can finish
 * between two polls, and waiting for a frame that may never be painted would
 * hang on a test that actually passed.
 */
async function scoreThirty(page, timeoutMs) {
  await page.goto(`${BASE}/calibrate`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid='model-preset-135m']", { timeout: 30000 });
  await page.click("[data-testid='model-preset-135m']");
  await page.fill("textarea", CSV);
  await page.click("text=Check items");
  await page.waitForSelector("text=Found 30 labelled items.", { timeout: 30000 });
  await page.click("[data-testid='run-button']");
  await page.waitForFunction(
    () =>
      document.querySelectorAll("[data-testid='results-row']").length === 30 ||
      document.querySelector("[data-testid='error-line']") !== null,
    null,
    { timeout: timeoutMs }
  );
  const error = page.locator("[data-testid='error-line']");
  if ((await error.count()) > 0) {
    throw new Error(`the run failed instead of scoring: ${await error.innerText()}`);
  }
  return trackStatus(page);
}

/**
 * Same rule as the main harness: a recorded exit is a real failure; a server
 * that stopped answering without exiting (this machine gets OOM-killed under
 * load) is restarted once, loudly.
 */
async function ensureServer() {
  assert.equal(serverExit, null, `the app server exited (code=${serverExit?.code} signal=${serverExit?.signal})`);
  try {
    if ((await fetch(`${BASE}/api/health`)).status === 200) return;
  } catch {
    /* not answering */
  }
  process.stderr.write("[model e2e] app server stopped answering; restarting it\n");
  server = undefined;
  await startServer();
}

/** prediction + confidence from a rendered row's text (computed, never hardcoded). */
function parseRow(text) {
  const prediction = /predicted\s+(\w+)/.exec(text)?.[1] ?? null;
  const confidence = /confidence\s+([\d.]+)%/.exec(text)?.[1];
  return { prediction, confidence: confidence === undefined ? null : Number(confidence) / 100 };
}

/** Spawn the built app with DEMO_MODE off (the real model path) and wait for it. */
async function startServer() {
  // detached: the whole group is killed in teardown, so no orphaned server
  // keeps this process's pipes open (see tests/e2e.test.mjs).
  server = spawn("pnpm", ["exec", "next", "start", "-p", String(PORT)], {
    cwd: ROOT,
    detached: true,
    env: { ...process.env, DEMO_MODE: "", NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", () => {});
  server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  server.on("exit", (code, signal) => {
    serverExit = { code, signal };
    process.stderr.write(`[server] exited code=${code} signal=${signal}\n`);
  });
  await waitForHealth();
}

before(async () => {
  await startServer();
  // A persistent profile keeps the HTTP cache across reloads, which is what
  // makes A9.3 (works with the network blocked after the first load) meaningful.
  userProfile = fs.mkdtempSync(path.join(os.tmpdir(), "wev-model-profile-"));
  context = await chromium.launchPersistentContext(userProfile, { viewport: { width: 1440, height: 1000 } });
});

after(async () => {
  await context?.close();
  if (server && !server.killed && !serverExit) {
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      server.kill("SIGKILL");
    }
  }
  if (userProfile) fs.rmSync(userProfile, { recursive: true, force: true });
});

test("A9.1 + A9.2 the weights load in a real browser and match the committed Node run", async () => {
  await ensureServer();
  const page = await context.newPage();
  watch(page);
  const started = Date.now();
  // One retry, and only for a transport failure before any weight byte arrived:
  // a flaky CDN is not a product signal, but a load that genuinely cannot happen
  // will fail twice and be reported.
  let finalStatus;
  try {
    finalStatus = await scoreThirty(page, LOAD_TIMEOUT_MS);
  } catch (e) {
    const transport = /Failed to fetch|network error|ERR_|Network or cross-origin/i.test(String(e.message ?? e));
    const gotBytes = weightResponses.some((r) => r.status === 200);
    if (!transport || gotBytes) throw e;
    process.stderr.write(`[model e2e] cold load hit a transport error (${e.message}); retrying once\n`);
    pageErrors.length = 0;
    await scoreThirty(page, LOAD_TIMEOUT_MS);
    finalStatus = await trackStatus(page);
  }
  assert.ok(
    !/Loading model/.test(finalStatus),
    `the status line must leave its loading state (saw: ${[...progressSeen].slice(-3).join(" | ")})`
  );
  assert.deepEqual(pageErrors, [], pageErrors.join("\n"));

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
    statusLinesSeen: [...progressSeen],
    weightFetch: {
      hubRequests: weightResponses.filter((r) => /huggingface\.co/.test(r.url)).length,
      cdnResponses: weightResponses.filter((r) => /hf\.co/.test(new URL(r.url).hostname)).length,
      runtimeResponses: weightResponses.filter((r) => /jsdelivr/.test(r.url)).length,
      note: "The Hub answers 302 for onnx/model_uint8.onnx and streams the bytes from an opaque path on its LFS CDN, so the weight fetch is identified by host, not by filename.",
    },
  };
  // Written before any assertion below: a failed parity run is exactly the
  // evidence that must survive.
  fs.writeFileSync(PARITY_FILE, JSON.stringify(report, null, 2) + "\n");

  // The Hub answers 302 for onnx/model_uint8.onnx and serves the bytes from an
  // opaque path on its LFS CDN (us.aws.cdn.hf.co), so "a 200 whose URL ends in
  // .onnx" is not a thing that exists any more. What is provable: the Hub was
  // asked for the weight file, and a 200 came back from an HF CDN host.
  const askedForWeights = weightResponses.filter(
    (r) => r.status === 302 && /onnx\/model_uint8\.onnx(\?|$)/.test(r.url)
  );
  assert.ok(
    askedForWeights.length > 0,
    `the page never requested the ONNX weights: ${JSON.stringify(weightResponses.slice(0, 8))}`
  );
  const servedBytes = weightResponses.filter((r) => r.status === 200 && /\.hf\.co$/.test(new URL(r.url).hostname));
  assert.ok(
    servedBytes.length > 0,
    `no weight bytes were served by the HF CDN: ${JSON.stringify(weightResponses.slice(0, 8))}`
  );
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
  await ensureServer();
  const page = await context.newPage();
  watch(page);
  // Two ways to be offline, and neither is a perfect "airplane mode":
  //   * context.setOffline(true) also cuts 127.0.0.1, so the app under test
  //     cannot even load (observed: net::ERR_INTERNET_DISCONNECTED on the page
  //     itself), and
  //   * a request route does leave localhost alone, but interception happens
  //     before the HTTP cache is consulted, so it cannot prove a cache hit
  //     (observed: the transformers.js runtime re-import fails).
  // So: block every non-local host, keep the app reachable, and record every
  // request that really leaves the machine. Whatever this test shows, the
  // offline-after-load claim stays UNVERIFIED in WHAT_IS_REAL.md unless it
  // passes with zero remote requests.
  const attemptedRemote = [];
  page.on("request", (req) => {
    const host = new URL(req.url()).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") attemptedRemote.push(req.url());
  });
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
  assert.deepEqual(attemptedRemote, [], `offline run reached for the network: ${attemptedRemote.join(", ")}`);
  await page.close();
});

test("A9.4 a model whose files are missing shows a plain error and is delisted", async () => {
  await ensureServer();
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
    await page.waitForSelector("[data-testid='error-line']", { timeout: 300000 });
    const shown = await page.locator("[data-testid='error-line']").innerText();
    assert.match(shown, /not found/i, shown);
    // The failed preset is removed for the session, never retried silently.
    await page.waitForSelector("text=removed: it failed to load", { timeout: 30000 });
    assert.deepEqual(pageErrors, [], pageErrors.join("\n"));
  } finally {
    await page.unroute("**/*");
  }
  await page.close();
});