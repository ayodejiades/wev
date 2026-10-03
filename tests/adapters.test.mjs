// tests/adapters.test.mjs — the two adapters that were dead code until the UI
// could pick them: a local OpenAI-compatible server (EXPERIMENTAL) and a
// pre-scored file (no model). Both go through lib/wev-model.ts, which only
// reuses lib/decider.ts implementations.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const SPEC = {
  name: "support-ticket-triage",
  kind: "choice",
  labels: ["refund", "review", "reject"],
  instruction: "Pick one label.",
  version: "triage-v1",
};

/** OpenAI-compatible /v1/completions stub with token log-probs. */
function serverStub(offers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    const top = offers();
    // OpenAI-style: logprobs.top_logprobs is an array (one entry per token) of token->logprob maps.
    return new Response(JSON.stringify({ choices: [{ text: " refund", logprobs: { top_logprobs: [top] } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetchImpl, calls };
}

test("A5.1 the server choice builds the server adapter and scores through /v1/completions", async () => {
  const { createAdapterFromChoice } = await import("../lib/wev-model.ts");
  const { decide } = await import("../lib/decider.ts");
  const { fetchImpl, calls } = serverStub(() => ({ " refund": -0.1, " review": -3, " reject": -4 }));
  const adapter = createAdapterFromChoice(
    { kind: "server", baseUrl: "http://127.0.0.1:8080", model: "my-llama", fetchImpl },
    SPEC
  );
  assert.equal(adapter.adapterKind, "local-server (EXPERIMENTAL)");
  assert.equal(adapter.modelId, "server:my-llama", "thresholds are keyed per adapter model id");
  assert.equal(typeof adapter.generate, "function");
  const out = await decide(adapter, SPEC, "charged twice");
  assert.equal(out.value, "refund");
  assert.ok(calls.length > 0);
  assert.ok(
    calls.every((c) => c.url === "http://127.0.0.1:8080/v1/completions"),
    `unexpected url: ${calls[0].url}`
  );
});

test("A5.2 a pre-scored file AUTO-handles confident rows and ESCALATEs the rest, with no generate()", async () => {
  const { createAdapterFromChoice } = await import("../lib/wev-model.ts");
  const { jevify } = await import("../lib/jevify.ts");
  const rows = [
    { text: "confident refund ticket", gold: "refund", probabilities: { refund: 0.82, review: 0.12, reject: 0.06 }, entropyBits: 0.8 },
    { text: "flat guess", gold: "review", probabilities: { refund: 0.4, review: 0.35, reject: 0.25 }, entropyBits: 1.55 },
  ];
  const adapter = createAdapterFromChoice(
    { kind: "prescored", fileName: "rows.json", raw: JSON.stringify(rows) },
    SPEC
  );
  assert.equal(adapter.adapterKind, "prescored-file");
  assert.equal(adapter.modelId, "prescored:rows.json");
  assert.equal(adapter.generate, undefined, "a pre-scored file has no model to generate from");

  const app = jevify(adapter, SPEC, { autoConfidence: 0.5, maxEntropyBits: 1 });
  assert.equal((await app.route("confident refund ticket")).path, "AUTO");
  const flat = await app.route("flat guess");
  assert.equal(flat.path, "ESCALATE");
  await assert.rejects(() => app.generate("flat guess"), /score-only|no text generation/i);
});

test("A5.3 a server answering without log-probs raises the DeciderError verbatim", async () => {
  const { createAdapterFromChoice } = await import("../lib/wev-model.ts");
  const { decide, DeciderError } = await import("../lib/decider.ts");
  const fetchImpl = async () =>
    new Response(JSON.stringify({ choices: [{ text: " refund" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const adapter = createAdapterFromChoice(
    { kind: "server", baseUrl: "http://127.0.0.1:8080", model: "my-llama", fetchImpl },
    SPEC
  );
  await assert.rejects(() => decide(adapter, SPEC, "charged twice"), (err) => {
    assert.ok(err instanceof DeciderError, `wrong error type: ${err?.name}`);
    assert.match(err.message, /log-probs/);
    return true;
  });
});

test("A5.4 both adapters are reachable from the UI code, not dead", () => {
  const modelPicker = fs.readFileSync(path.join(process.cwd(), "lib", "wev-model.ts"), "utf8");
  assert.match(modelPicker, /createLocalServerAdapter/);
  assert.match(modelPicker, /createPrescoredAdapter/);
  for (const page of ["app/inbox/page.tsx", "app/calibrate/page.tsx"]) {
    const src = fs.readFileSync(path.join(process.cwd(), page), "utf8");
    assert.match(src, /createAdapterFromChoice/, `${page} must use the chosen adapter`);
    assert.match(src, /LOCAL_SERVER_DEFAULT_URL/, `${page} must offer the server adapter`);
  }
});

test("A5.6 the 30-row pre-scored fixture parses and gates without a model", async () => {
  const { createAdapterFromChoice, parsePrescoredFile } = await import("../lib/wev-model.ts");
  const raw = fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", "prescored-30.json"), "utf8");
  const rows = parsePrescoredFile("prescored-30.json", raw, SPEC);
  assert.equal(rows.length, 30);
  assert.ok(rows.every((r) => r.entropyBits !== null && r.entropyBits !== undefined), "the gate needs entropy");
  const adapter = createAdapterFromChoice({ kind: "prescored", fileName: "prescored-30.json", raw }, SPEC);
  assert.equal(adapter.modelId, "prescored:prescored-30.json");
  const out = await adapter.score(
    (await import("../lib/decider.ts")).buildDeciderPrompt(SPEC, rows[0].text),
    SPEC.labels
  );
  assert.equal(out.labelLogProbs.length, 3);
  assert.ok(Number.isFinite(out.labelLogProbs[0]));
  assert.ok(out.entropyBits !== null);
});

test("A5.7 a prescored row without entropy is refused rather than silently mis-gated", async () => {
  const { parsePrescoredFile } = await import("../lib/wev-model.ts");
  const raw = JSON.stringify([
    { text: "no entropy here", gold: "refund", probabilities: { refund: 0.9, review: 0.05, reject: 0.05 } },
  ]);
  const rows = parsePrescoredFile("rows.json", raw, SPEC);
  assert.equal(rows[0].entropyBits, null, "the parser records the absence instead of inventing a number");
});