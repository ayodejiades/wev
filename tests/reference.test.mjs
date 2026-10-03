// tests/reference.test.mjs — the OPTIONAL reference-model labeller (lib/reference.ts).
// No network: every request goes through an injected stub fetch. These tests are
// the only place a fake reply is allowed to exist; evidence/ never holds one
// unless `pnpm reference` recorded a real model run.
import assert from "node:assert/strict";
import { test } from "node:test";

const SPEC = {
  name: "support-ticket-triage",
  kind: "choice",
  labels: ["refund", "review", "reject"],
  instruction:
    "You triage support tickets into exactly one label: refund, review, or reject.\nReply with only the label.",
  fewShots: [
    { text: "I was charged twice for $18, please give it back", label: "refund" },
    { text: "Where is my order? Tracking says delivered", label: "review" },
  ],
  version: "triage-v1",
};

const CFG = {
  baseUrl: "https://api.example.test/v1",
  model: "test-model",
  apiKey: "sk-test-DO-NOT-LEAK-000111222",
};

/** Stub that answers a chat/completions request with `reply` and records the request. */
function stubOk(reply, extra = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(String(init.body)) });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: reply } }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  return { fetchImpl, calls, ...extra };
}

test("A1.1 reference reply \"Refund.\" parses to the label refund", async () => {
  const { labelWithReference } = await import("../lib/reference.ts");
  const { fetchImpl, calls } = stubOk("Refund.");
  const out = await labelWithReference(
    { ...CFG, fetchImpl },
    SPEC,
    [{ id: "T-001", text: "charged twice" }]
  );
  assert.deepEqual(out, [{ id: "T-001", label: "refund", raw: "Refund." }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.example.test/v1/chat/completions");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${CFG.apiKey}`);
  const body = calls[0].body;
  assert.equal(body.model, "test-model");
  assert.equal(body.temperature, 0);
  assert.equal(body.max_tokens, 8);
});

test("A1.2 a non-label reply fails closed, naming the item id", async () => {
  const { labelWithReference, ReferenceError } = await import("../lib/reference.ts");
  const { fetchImpl } = stubOk("I think refund");
  await assert.rejects(
    () => labelWithReference({ ...CFG, fetchImpl }, SPEC, [{ id: "T-077", text: "charged twice" }]),
    (err) => {
      assert.equal(err.name, "ReferenceError");
      assert.match(err.message, /T-077/);
      return true;
    }
  );
  assert.equal(typeof ReferenceError, "function");
});

test("A1.3 an HTTP error body containing the key never leaks it", async () => {
  const { labelWithReference } = await import("../lib/reference.ts");
  const fetchImpl = async () =>
    new Response(`{"error":"invalid api key sk-test-DO-NOT-LEAK-000111222 supplied"}`, { status: 401 });
  await assert.rejects(
    () => labelWithReference({ ...CFG, fetchImpl }, SPEC, [{ id: "T-001", text: "x" }]),
    (err) => {
      assert.match(err.message, /401/);
      assert.ok(!err.message.includes(CFG.apiKey), "api key must never appear in an error");
      assert.match(err.message, /\[redacted\]/);
      return true;
    }
  );
});

test("A1.4 the recorded request carries no few-shot text and no gold label", async () => {
  const { labelWithReference, buildReferenceMessages } = await import("../lib/reference.ts");
  const { fetchImpl, calls } = stubOk("review");
  const text = "The blender arrived cracked and I want my money back";
  await labelWithReference({ ...CFG, fetchImpl }, SPEC, [{ id: "T-042", text }]);
  const serialized = JSON.stringify(calls[0].body);
  for (const shot of SPEC.fewShots) {
    assert.ok(!serialized.includes(shot.text), `few-shot text leaked: ${shot.text}`);
  }
  assert.ok(!serialized.includes("T-042"), "item id must not reach the reference model");
  assert.ok(!/"gold"/.test(serialized), "gold label must not reach the reference model");
  assert.ok(!/"fewShots"/.test(serialized));
  // The labels are necessarily named (it has to pick one); the item's gold is not given.
  assert.ok(serialized.includes("refund"));
  const msgs = buildReferenceMessages(SPEC, text);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, "system");
  assert.ok(msgs[0].content.startsWith(SPEC.instruction));
  assert.match(msgs[0].content, /Reply with exactly one label from: refund, review, reject\. No other text\./);
  assert.deepEqual(msgs[1], { role: "user", content: text });
});

test("A1.5 output order equals input order when a stub resolves in reverse", async () => {
  const { labelWithReference } = await import("../lib/reference.ts");
  const items = Array.from({ length: 8 }, (_, i) => ({
    id: `T-${String(i + 1).padStart(3, "0")}`,
    text: `ticket ${i}`,
  }));
  const labelFor = (n) => (Number(n) === 7 ? "reject" : "review");
  const delays = items.map((_, i) => items.length - i); // first item is slowest
  let k = 0;
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(String(init.body));
    const n = body.messages[1].content.replace("ticket ", "");
    const wait = delays[k++];
    await new Promise((r) => setTimeout(r, wait));
    return new Response(
      JSON.stringify({ choices: [{ message: { content: labelFor(n) } }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  const out = await labelWithReference({ ...CFG, fetchImpl }, SPEC, items, { concurrency: 4 });
  assert.deepEqual(
    out.map((o) => o.id),
    items.map((i) => i.id)
  );
  assert.equal(out[7].label, "reject");
  assert.equal(out[0].label, "review");
});

test("A1.6 a transport failure reports the endpoint as unreachable", async () => {
  const { labelWithReference } = await import("../lib/reference.ts");
  const fetchImpl = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(
    () => labelWithReference({ ...CFG, fetchImpl }, SPEC, [{ id: "T-001", text: "x" }]),
    (err) => {
      assert.equal(err.name, "ReferenceError");
      assert.ok(err.message.startsWith("reference endpoint unreachable"), err.message);
      assert.match(err.message, /fetch failed/);
      return true;
    }
  );
});

test("reference: agreement summary counts two labellers, not truth", async () => {
  const { summarizeReference } = await import("../lib/reference.ts");
  const four = summarizeReference(
    [
      { id: "a", label: "refund" },
      { id: "b", label: "review" },
      { id: "c", label: "review" },
      { id: "d", label: "reject" },
    ],
    { a: "refund", b: "reject", c: "review", d: "review" }
  );
  assert.deepEqual(four, { agree: 2, total: 4, rate: 0.5 });
  const threeOfFour = summarizeReference(
    [
      { id: "a", label: "refund" },
      { id: "b", label: "review" },
      { id: "c", label: "review" },
      { id: "d", label: "refund" },
    ],
    { a: "refund", b: "review", c: "review", d: "reject" }
  );
  assert.deepEqual(threeOfFour, { agree: 3, total: 4, rate: 0.75 });
});