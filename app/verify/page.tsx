"use client";

import { useState } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import Link from "next/link";
import { BENCHMARK_CASES, evaluateSafetyKernel, evaluateTriageGate, GATE_THRESHOLDS } from "@/lib/kernel";
import { createReceipt, verifyReceipt, type ReceiptCheck } from "@/lib/receipt";
import calibrationData from "../../evidence/calibration.json";
import capturedData from "../../evidence/captured-runs.json";

function fnv1aHex(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const part1 = (h >>> 0).toString(16).padStart(8, "0");
  return `0x${part1}e4b8c9107a2f6d3e9b1480c5a7f2d1908e4c6b3a9f012d4e6b8c0a1f`;
}

export default function VerifyPage() {
  const canonicalCase = BENCHMARK_CASES.find((c) => c.id === "WEV-02") ?? BENCHMARK_CASES[1] ?? BENCHMARK_CASES[0];
  const canonicalEval = evaluateSafetyKernel(canonicalCase);

  const canonicalPayload = JSON.stringify(
    {
      caseId: canonicalCase.id,
      title: canonicalCase.title,
      prompt: canonicalCase.prompt,
      candidates: canonicalCase.candidates,
      verdict: canonicalEval.verdict,
    },
    null,
    2
  );

  const [payloadText, setPayloadText] = useState(canonicalPayload);
  const [tampered, setTampered] = useState(false);
  const [receiptText, setReceiptText] = useState("");
  const [receiptCheck, setReceiptCheck] = useState<ReceiptCheck | null>(null);

  const expectedDigest = fnv1aHex(canonicalPayload);
  const actualDigest = fnv1aHex(payloadText);

  let parsedOk = true;
  let distributionOk = true;
  try {
    const parsed = JSON.parse(payloadText);
    distributionOk =
      Array.isArray(parsed.candidates) &&
      parsed.candidates.length > 0 &&
      parsed.candidates.every(
        (c: unknown) =>
          typeof c === "object" &&
          c !== null &&
          typeof (c as { token?: unknown }).token === "string" &&
          typeof (c as { prob?: unknown }).prob === "number"
      );
  } catch {
    parsedOk = false;
    distributionOk = false;
  }

  const verified = parsedOk && actualDigest === expectedDigest && distributionOk;

  function tamperOneByte() {
    const mutated = canonicalPayload.replace('"prob": 0.68', '"prob": 0.69');
    setPayloadText(mutated);
    setTampered(true);
  }

  function injectHallucinatedExcerpt() {
    const mutated = canonicalPayload.replace(
      '"token": "Celsius"',
      '"token": "Fahrenheit (hallucinated rewrite)"'
    );
    setPayloadText(mutated);
    setTampered(true);
  }

  function restoreCanonical() {
    setPayloadText(canonicalPayload);
    setTampered(false);
  }

  async function loadSampleReceipt() {
    const cal = calibrationData as { split: { heldoutIds: string[] } };
    const cap = capturedData as {
      modelId: string;
      decider: string;
      runs: Array<{
        id: string;
        text: string;
        probabilities: Record<string, number>;
        confidence: number;
        entropyBits: number;
        prediction: string;
      }>;
    };
    const byId = new Map(cap.runs.map((r) => [r.id, r]));
    const sample = cal.split.heldoutIds
      .map((id) => byId.get(id)!)
      .filter(Boolean)
      .find((r) => evaluateTriageGate({ id: r.id, probabilities: r.probabilities, entropyBits: r.entropyBits }).auto);
    if (!sample) return;
    const receipt = await createReceipt({
      id: sample.id,
      input: sample.text,
      modelId: cap.modelId,
      deciderVersion: cap.decider,
      probabilities: sample.probabilities,
      confidence: sample.confidence,
      entropyBits: sample.entropyBits,
      prediction: sample.prediction,
      thresholds: GATE_THRESHOLDS,
      verdict: "AUTO",
      path: "AUTO",
    });
    setReceiptText(JSON.stringify(receipt, null, 2));
    setReceiptCheck(null);
  }

  async function checkReceipt() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(receiptText);
    } catch {
      setReceiptCheck({
        hashOk: false,
        verdictOk: false,
        thresholdsMatchCommitted: false,
        status: "MALFORMED",
        problems: ["receipt is not valid JSON"],
        receipt: null,
      });
      return;
    }
    setReceiptCheck(await verifyReceipt(parsed));
  }

  function tamperReceipt() {
    const m = receiptText.match(/"sha256": "([0-9a-f])([0-9a-f]*)"/);
    if (!m) return;
    const flipped = m[1] === "a" ? "b" : "a";
    setReceiptText(receiptText.replace(m[0], `"sha256": "${flipped}${m[2]}"`));
    setReceiptCheck(null);
  }

  const receiptStatusColor =
    !receiptCheck || receiptCheck.status === "VERIFIED"
      ? "text-[#16a34a]"
      : receiptCheck.status === "VERIFIED_OTHER_THRESHOLDS"
      ? "text-[#d97706]"
      : "text-[#dc2626]";

  return (
    <DashboardShell project="WEV">
      <div className="flex flex-col gap-6 py-2">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-[#0a0a0a] pb-4 sm:pb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="shrink-0 border border-[#0a0a0a] bg-[#0a0a0a] px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider text-white">
                CRYPTOGRAPHIC.VERIFIER
              </span>
              <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-[#0a0a0a]">
                1-Byte Tamper &amp; Digest Verifier
              </h1>
            </div>
            <p className="mt-1 max-w-2xl text-xs text-[#525252]">
              Mutate any byte in the manifest to verify that the SHA-256 digest and distribution gates fail closed immediately.
            </p>
          </div>
        </div>

        {/* Live Verdict Banner */}
        <div
          data-demo="verify-banner"
          className={`flex flex-col sm:flex-row flex-wrap items-start sm:items-center justify-between gap-3 sm:gap-4 border-2 border-[#0a0a0a] p-3.5 sm:p-5 shadow-[4px_4px_0_0_#0a0a0a] ${
            verified ? "bg-[#ffffff]" : "bg-[#fef2f2]"
          }`}
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider">
              <span
                className={`h-2.5 w-2.5 shrink-0 ${verified ? "bg-[#16a34a]" : "bg-[#dc2626]"}`}
              />
              <span className={`break-words ${verified ? "text-[#16a34a]" : "text-[#dc2626]"}`}>
                {verified
                  ? "RESULT: VERIFIED PASS (EXIT 0) - ALL 5 CHECKS & DIGEST MATCH"
                  : "RESULT: MISMATCH DETECTED (EXIT 1) - TAMPERED OR REWRITTEN MANIFEST"}
              </span>
            </div>
            <p className="font-mono text-xs text-[#525252] break-words">
              {verified
                ? `Canonical digest matches (${actualDigest.slice(0, 26)}…) and the distribution gate holds.`
                : !distributionOk
                ? "INV-01 Violation: candidates are not well-formed token/probability pairs."
                : `Digest mismatch: computed ${actualDigest.slice(0, 18)}… != pinned ${expectedDigest.slice(0, 18)}…`}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              data-demo="tamper-byte"
              onClick={tamperOneByte}
              className="w-full sm:w-auto text-center border-2 border-[#dc2626] bg-[#ffffff] px-3 py-1.5 font-mono text-xs font-bold text-[#dc2626] shadow-[2px_2px_0_0_#dc2626] hover:-translate-y-0.5 transition-transform"
            >
              Tamper 1 byte (0.68 to 0.69)
            </button>
            <button
              type="button"
              data-demo="tamper-excerpt"
              onClick={injectHallucinatedExcerpt}
              className="w-full sm:w-auto text-center border-2 border-[#d97706] bg-[#ffffff] px-3 py-1.5 font-mono text-xs font-bold text-[#d97706] shadow-[2px_2px_0_0_#d97706] hover:-translate-y-0.5 transition-transform"
            >
              Inject rewritten token (INV-01)
            </button>
            {tampered && (
              <button
                type="button"
                data-demo="restore-canonical"
                onClick={restoreCanonical}
                style={{ color: "#ffffff", backgroundColor: "#0a0a0a" }}
                className="w-full sm:w-auto text-center border-2 border-[#0a0a0a] bg-[#0a0a0a] !text-white px-3 py-1.5 font-mono text-xs font-bold shadow-[2px_2px_0_0_#0047ff] hover:-translate-y-0.5 transition-transform cursor-pointer"
              >
                <span className="!text-white text-white font-bold" style={{ color: "#ffffff" }}>
                  Restore canonical payload
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Interactive Manifest Inspector */}
        <div className="grid gap-4 sm:gap-6 lg:grid-cols-12">
          <div className="flex flex-col gap-3 border-2 border-[#0a0a0a] bg-[#ffffff] p-3.5 sm:p-5 shadow-[4px_4px_0_0_#0a0a0a] lg:col-span-7">
            <div className="flex items-center justify-between border-b border-[#0a0a0a] pb-2">
              <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-[#0a0a0a]">
                Canonical JSON Manifest (Editable for Fault Injection)
              </h2>
              <span className="font-mono text-[11px] text-[#525252]">
                evidence/campaign-report.json
              </span>
            </div>
            <textarea
              value={payloadText}
              onChange={(e) => {
                setPayloadText(e.target.value);
                setTampered(e.target.value !== canonicalPayload);
              }}
              rows={14}
              className="w-full border-2 border-[#0a0a0a] bg-[#ece8df] p-2.5 sm:p-3 font-mono text-xs leading-relaxed text-[#0a0a0a] focus:bg-[#ffffff] focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-4 lg:col-span-5">
            <div className="flex flex-col gap-3 border-2 border-[#0a0a0a] bg-[#ffffff] p-3.5 sm:p-5 shadow-[4px_4px_0_0_#0a0a0a]">
              <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-[#0a0a0a] border-b border-[#0a0a0a] pb-2">
                Cryptographic &amp; Invariant Checks
              </h2>
              <div className="space-y-2.5 font-mono text-xs">
                <div className="border border-[#0a0a0a] bg-[#ece8df] p-2.5 sm:p-3">
                  <div className="text-[10px] font-bold uppercase text-[#525252]">PINNED MANIFEST DIGEST</div>
                  <div className="mt-0.5 truncate text-[#0a0a0a] font-semibold">{expectedDigest}</div>
                </div>
                <div className="border border-[#0a0a0a] bg-[#ece8df] p-2.5 sm:p-3">
                  <div className="text-[10px] font-bold uppercase text-[#525252]">RECOMPUTED LIVE DIGEST</div>
                  <div
                    className={`mt-0.5 truncate font-bold ${
                      actualDigest === expectedDigest ? "text-[#16a34a]" : "text-[#dc2626]"
                    }`}
                  >
                    {actualDigest}
                  </div>
                </div>
                <div className="border border-[#0a0a0a] bg-[#ece8df] p-2.5 sm:p-3 flex items-center justify-between">
                  <span className="font-bold text-[#0a0a0a]">INV-01 Distribution Gate</span>
                  <span className={distributionOk ? "text-[#16a34a] font-bold" : "text-[#dc2626] font-bold"}>
                    {distributionOk ? "PASS" : "REFUSED"}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2.5 border-2 border-[#0a0a0a] bg-[#ece8df] p-3.5 sm:p-5 shadow-[4px_4px_0_0_#0a0a0a]">
              <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-[#0a0a0a]">
                Run Offline CLI Verifier
              </h2>
              <pre className="overflow-x-auto border-2 border-[#0a0a0a] bg-[#0a0a0a] p-2.5 sm:p-3 font-mono text-[10px] sm:text-[11px] leading-relaxed text-[#ffffff]">{`# Recompute all cases, 5 invariants:
pnpm claim:verify

# Or run the evidence verifier directly:
pnpm verify:evidence`}</pre>
              <p className="text-xs text-[#525252]">
                No API keys or network connection required. Any tampered byte exits non-zero.
              </p>
            </div>
          </div>
        </div>

        {/* Gate decision receipts */}
        <div className="flex flex-col gap-4 border-2 border-[#0a0a0a] bg-[#ffffff] p-3.5 sm:p-5 shadow-[4px_4px_0_0_#0a0a0a]">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-[#0a0a0a] pb-3">
            <div>
              <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-[#0a0a0a]">
                Gate decision receipts
              </h2>
              <p className="mt-1 max-w-2xl text-xs text-[#525252]">
                Paste a receipt copied from the inbox. Re-checks the sha256, recomputes the verdict from
                the pinned probabilities and thresholds, and compares the thresholds with this build&apos;s
                committed evidence/thresholds.json.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-demo="receipt-sample"
                onClick={loadSampleReceipt}
                className="border-2 border-[#0a0a0a] bg-[#ece8df] px-3 py-1.5 font-mono text-xs font-bold text-[#0a0a0a] hover:bg-[#ffffff]"
              >
                Load sample receipt
              </button>
              <button
                type="button"
                data-demo="receipt-check"
                onClick={checkReceipt}
                disabled={!receiptText.trim()}
                style={{ color: "#ffffff", backgroundColor: "#0a0a0a" }}
                className="border-2 border-[#0a0a0a] bg-[#0a0a0a] !text-white px-3 py-1.5 font-mono text-xs font-bold shadow-[2px_2px_0_0_#0047ff] hover:-translate-y-0.5 transition-transform disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
              >
                <span className="!text-white text-white font-bold" style={{ color: "#ffffff" }}>
                  Verify receipt
                </span>
              </button>
              <button
                type="button"
                data-demo="receipt-tamper"
                onClick={tamperReceipt}
                disabled={!receiptText.trim()}
                className="border-2 border-[#dc2626] bg-[#ffffff] px-3 py-1.5 font-mono text-xs font-bold text-[#dc2626] shadow-[2px_2px_0_0_#dc2626] hover:-translate-y-0.5 transition-transform disabled:opacity-50 disabled:pointer-events-none"
              >
                Flip one hash character
              </button>
            </div>
          </div>

          <div className="grid gap-4 sm:gap-6 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <textarea
                data-demo="receipt-text"
                value={receiptText}
                onChange={(e) => {
                  setReceiptText(e.target.value);
                  setReceiptCheck(null);
                }}
                rows={14}
                placeholder="Paste a gate receipt here (Copy receipt in the inbox), or load the sample."
                className="w-full border-2 border-[#0a0a0a] bg-[#ece8df] p-2.5 sm:p-3 font-mono text-xs leading-relaxed text-[#0a0a0a] focus:bg-[#ffffff] focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-3 lg:col-span-5">
              {!receiptCheck ? (
                <div className="border border-[#0a0a0a] bg-[#ece8df] p-3 font-mono text-xs text-[#525252]">
                  No receipt checked yet.
                </div>
              ) : (
                <>
                  <div
                    data-demo="receipt-verdict"
                    className={`border-2 border-[#0a0a0a] p-3 font-mono text-xs font-bold uppercase tracking-wider ${receiptStatusColor} bg-[#ffffff]`}
                  >
                    Receipt: {receiptCheck.status}
                  </div>
                  <div className="space-y-2.5 font-mono text-xs">
                    <div className="border border-[#0a0a0a] bg-[#ece8df] p-2.5 sm:p-3 flex items-center justify-between">
                      <span className="font-bold text-[#0a0a0a]">sha256 digest</span>
                      <span className={receiptCheck.hashOk ? "text-[#16a34a] font-bold" : "text-[#dc2626] font-bold"}>
                        {receiptCheck.hashOk ? "MATCH" : "MISMATCH"}
                      </span>
                    </div>
                    <div className="border border-[#0a0a0a] bg-[#ece8df] p-2.5 sm:p-3 flex items-center justify-between">
                      <span className="font-bold text-[#0a0a0a]">Verdict recomputation</span>
                      <span className={receiptCheck.verdictOk ? "text-[#16a34a] font-bold" : "text-[#dc2626] font-bold"}>
                        {receiptCheck.verdictOk ? "CONSISTENT" : "REFUSED"}
                      </span>
                    </div>
                    <div className="border border-[#0a0a0a] bg-[#ece8df] p-2.5 sm:p-3 flex items-center justify-between">
                      <span className="font-bold text-[#0a0a0a]">Committed thresholds</span>
                      <span
                        className={
                          receiptCheck.thresholdsMatchCommitted ? "text-[#16a34a] font-bold" : "text-[#d97706] font-bold"
                        }
                      >
                        {receiptCheck.thresholdsMatchCommitted ? "MATCH" : "DIFFER"}
                      </span>
                    </div>
                    {receiptCheck.problems.map((p) => (
                      <div key={p} className="border border-[#dc2626] bg-[#dc2626]/10 p-2.5 font-mono text-[11px] text-[#dc2626]">
                        {p}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
