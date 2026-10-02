"use client";

// app/live/page.tsx — the live inspector: a real tiny model (SmolLM2, 135M params,
// quantized, ~130MB first download) scores next-token probabilities on the device,
// and lib/kernel.ts renders the verdict.
import Link from "next/link";
import { useEffect, useState } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { evaluateDeterministicKernel } from "@/lib/kernel";
import { scoreNextToken } from "@/lib/wev-model";

type Phase = "idle" | "loading" | "scoring" | "done" | "error";

export default function LiveInspectorPage() {
  const [prompt, setPrompt] = useState("The capital of France is");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [result, setResult] = useState<null | {
    generated: string;
    candidates: { token: string; prob: number }[];
    rawTopProbSum: number;
    fullVocabEntropyBits: number;
    verdict: ReturnType<typeof evaluateDeterministicKernel>;
    modelId: string;
  }>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search).get("prompt");
      if (p) setPrompt(p);
    }
  }, []);

  async function run() {
    setPhase("loading");
    setError("");
    setResult(null);
    try {
      const live = await scoreNextToken(prompt, 5, (pct, label) => {
        setProgress(pct);
        setProgressLabel(label);
        if (pct >= 90) setPhase("scoring");
      });
      const verdict = evaluateDeterministicKernel({
        caseId: "live",
        prompt: live.prompt,
        candidates: live.candidates,
      });
      setResult({
        generated: live.generated,
        candidates: live.candidates,
        rawTopProbSum: live.rawTopProbSum,
        fullVocabEntropyBits: live.fullVocabEntropyBits,
        verdict,
        modelId: live.modelId,
      });
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  const refused = result ? result.verdict.state.startsWith("ABSTAIN_") : false;
  const uncertain = result?.verdict.state === "UNCERTAIN_FLAG";

  return (
    <DashboardShell project="WEV">
      <div className="flex flex-col gap-6 py-2">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-[#0a0a0a] pb-4 sm:pb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="shrink-0 border border-[#0a0a0a] bg-[#0a0a0a] px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider text-white">
                INFERENCE.LIVE
              </span>
              <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-[#0a0a0a]">
                Live Next-Token Inspector
              </h1>
            </div>
            <p className="mt-1 max-w-2xl text-xs text-[#525252]">
              SmolLM2-135M running client-side in browser. Logits scored live by <code className="border border-[#0a0a0a] bg-[#ece8df] px-1.5 py-0.5 font-mono text-xs text-[#0a0a0a]">lib/kernel.ts</code>.
            </p>
          </div>
        </div>

        {/* Input & Controls */}
        <section className="flex flex-col gap-3 border-2 border-[#0a0a0a] bg-[#ffffff] p-3.5 sm:p-5 shadow-[4px_4px_0_0_#0a0a0a]">
          <div className="flex flex-col gap-1.5 text-xs">
            <label htmlFor="live-prompt-input" className="font-mono font-bold uppercase tracking-wider text-[#0a0a0a]">
              Prompt
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="live-prompt-input"
                type="text"
                value={prompt}
                data-demo="live-prompt"
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && phase !== "loading" && phase !== "scoring" && prompt.trim()) {
                    run();
                  }
                }}
                className="flex-1 border-2 border-[#0a0a0a] bg-[#ece8df] p-2.5 font-mono text-xs text-[#0a0a0a] focus:bg-[#ffffff] focus:outline-none"
              />
              <button
                type="button"
                onClick={run}
                data-demo="live-inspect"
                disabled={phase === "loading" || phase === "scoring" || !prompt.trim()}
                style={{ color: "#ffffff", backgroundColor: "#0a0a0a" }}
                className="w-full sm:w-auto shrink-0 border-2 border-[#0a0a0a] bg-[#0a0a0a] !text-white px-5 py-2.5 font-mono text-xs font-bold shadow-[2px_2px_0_0_#0047ff] hover:-translate-y-0.5 transition-transform disabled:opacity-50 cursor-pointer"
              >
                <span className="!text-white text-white font-bold" style={{ color: "#ffffff" }}>
                  {phase === "loading" ? `Loading ${progress}%` : phase === "scoring" ? "Scoring…" : "Inspect Token"}
                </span>
              </button>
            </div>
          </div>

          {/* Quick test presets */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#525252]">
              Presets:
            </span>
            {[
              "The capital of France is",
              "Water freezes at zero degrees",
              "The future of artificial intelligence will be",
              "The capital of Nigeria is",
            ].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPrompt(p)}
                className="border border-[#0a0a0a] bg-[#ece8df] px-2 py-1 font-mono text-[10px] font-semibold text-[#0a0a0a] hover:bg-[#ffffff] hover:border-[#0047ff] transition-colors"
              >
                &ldquo;{p}&rdquo;
              </button>
            ))}
          </div>

          {(phase === "loading" || phase === "scoring") && (
            <div className="flex flex-col gap-1.5 pt-2">
              <div className="h-3 overflow-hidden border-2 border-[#0a0a0a] bg-[#ece8df]">
                <div className="h-full bg-[#0047ff] transition-all" style={{ width: `${progress}%` }} />
              </div>
              <span className="font-mono text-[11px] text-[#525252]">{progressLabel}</span>
            </div>
          )}

          {phase === "error" && (
            <p className="border-2 border-[#dc2626] bg-[#dc2626]/10 p-3 font-mono text-xs text-[#dc2626]">
              {error}
            </p>
          )}
        </section>

        {/* Results Card */}
        {result && (
          <section data-demo="live-result" className="flex flex-col gap-4 sm:gap-5 border-2 border-[#0a0a0a] bg-[#ffffff] p-3.5 sm:p-5 shadow-[4px_4px_0_0_#0a0a0a]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-[#0a0a0a] pb-3">
              <div>
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#525252]">
                  Model Generation &middot; Kernel Evaluation
                </span>
                <h2 className="font-mono text-lg sm:text-xl font-bold text-[#0a0a0a] break-words">
                  Predicted &ldquo;{result.generated}&rdquo; &middot; {result.verdict.state}
                </h2>
              </div>
              <span
                className={`border-2 px-2.5 py-1 font-mono text-xs font-bold uppercase tracking-wider ${
                  refused
                    ? "border-[#dc2626] bg-[#dc2626]/10 text-[#dc2626]"
                    : uncertain
                    ? "border-[#d97706] bg-[#d97706]/10 text-[#d97706]"
                    : "border-[#16a34a] bg-[#16a34a]/10 text-[#16a34a]"
                }`}
              >
                H={result.verdict.entropyBits} bits
              </span>
            </div>

            {/* Probability Bars */}
            <div className="flex flex-col gap-2.5 font-mono text-xs">
              <div className="font-bold text-[#0a0a0a]">Candidate Distribution (Renormalized Top-5):</div>
              {result.candidates.map((cand, idx) => (
                <div key={cand.token} className="flex items-center gap-2 sm:gap-3">
                  <span className="w-16 sm:w-28 truncate font-bold text-[#0a0a0a] shrink-0 text-xs">
                    #{idx + 1} {cand.token}
                  </span>
                  <div className="h-3 flex-1 border border-[#0a0a0a] bg-[#ece8df] overflow-hidden">
                    <div
                      className={`h-full ${refused ? "bg-[#dc2626]" : uncertain ? "bg-[#d97706]" : idx === 0 ? "bg-[#0a0a0a]" : "bg-[#525252]"}`}
                      style={{ width: `${Math.round(cand.prob * 100)}%` }}
                    />
                  </div>
                  <span className="w-12 sm:w-16 text-right font-bold text-[#0a0a0a] shrink-0 text-xs">
                    {(cand.prob * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>

            <p className="text-xs leading-relaxed text-[#525252]">{result.verdict.summary}</p>

            <div className="border border-[#0a0a0a] bg-[#ece8df] p-2.5 font-mono text-[11px] text-[#525252]">
              Renormalized Top-5: sum = 1.0 (raw sum = {(result.rawTopProbSum * 100).toFixed(1)}%). Full-vocab H = {result.fullVocabEntropyBits} bits.
            </div>

            {/* Invariant status */}
            <div className="flex flex-col gap-2 pt-1">
              <div className="font-mono text-xs font-bold uppercase tracking-wider text-[#0a0a0a]">
                Kernel Invariant Verification
              </div>
              <div className="divide-y border-2 border-[#0a0a0a] bg-[#ece8df]">
                {result.verdict.invariants.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 font-mono text-[11px]"
                  >
                    <span>
                      <strong className="text-[#0a0a0a]">{inv.id}</strong> &middot; {inv.name}
                    </span>
                    <span className={inv.passed ? "font-bold text-[#16a34a]" : "font-bold text-[#dc2626]"}>
                      {inv.passed ? "PASS" : "BLOCK"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="font-mono text-[11px] text-[#525252] pt-1">
              Model: {result.modelId} &middot; Executed in browser on device
            </div>

            <div className="pt-1">
              <Link
                href="/inbox"
                className="inline-block border-2 border-[#0a0a0a] bg-[#ffffff] px-4 py-2 font-mono text-xs font-semibold text-[#0a0a0a] shadow-[2px_2px_0_0_#0a0a0a] hover:-translate-y-0.5 transition-transform"
              >
                Gate this prompt on /inbox
              </Link>
            </div>
          </section>
        )}
      </div>
    </DashboardShell>
  );
}
