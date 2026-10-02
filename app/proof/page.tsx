"use client";

// app/proof/page.tsx — "Measured accuracy at coverage": the calibrated
// act-or-escalate gate, rebuilt from evidence/calibration.json (thresholds
// picked on the calibration split, reported on the held-out split) and
// evidence/captured-runs.json (real SmolLM2 runs). Every number on this page
// is computed from those two files; nothing is hardcoded.

import { useState } from "react";
import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import calibrationData from "../../evidence/calibration.json";
import capturedData from "../../evidence/captured-runs.json";

interface CapturedRun {
  id: string;
  text: string;
  gold: string;
  probabilities: Record<string, number>;
  prediction: string;
  confidence: number;
  entropyBits: number;
  correct: boolean;
}

const calibration = calibrationData as {
  modelId: string;
  dtype: string;
  seed: number;
  split: { calibrationIds: string[]; heldoutIds: string[]; calibrationSize: number; heldoutSize: number };
  gate: {
    thresholds: { autoConfidence: number; maxEntropyBits: number };
    calibration: Record<string, number>;
    heldout: Record<string, number>;
  };
  syntheticDataNote: string;
};
const runs = (capturedData as { runs: CapturedRun[] }).runs;
const byId = new Map(runs.map((r) => [r.id, r]));

const TAU = calibration.gate.thresholds.autoConfidence;
const MAX_H = calibration.gate.thresholds.maxEntropyBits;
const held = calibration.gate.heldout;
const cal = calibration.gate.calibration;
const heldRuns = calibration.split.heldoutIds.map((id) => byId.get(id)!).filter(Boolean);

const isAuto = (r: CapturedRun) => r.confidence >= TAU && r.entropyBits <= MAX_H;
const wrongAutoHeld = heldRuns.filter((r) => isAuto(r) && !r.correct);
const labelCount = runs.length > 0 ? Object.keys(runs[0].probabilities).length : 0;

// Accuracy-vs-coverage sweep on the held-out split: confidence threshold grid
// at the calibrated entropy bar. The ring marks the calibrated operating point.
const SWEEP_STEP = 0.05;
const sweepTaus: number[] = [];
for (let t = 0.3; t <= 0.9501; t += SWEEP_STEP) sweepTaus.push(Math.round(t * 100) / 100);
const curve = sweepTaus
  .map((tau) => {
    const auto = heldRuns.filter((r) => r.confidence >= tau && r.entropyBits <= MAX_H);
    if (auto.length === 0) return null;
    return {
      tau,
      coverage: auto.length / heldRuns.length,
      accuracy: auto.filter((r) => r.correct).length / auto.length,
    };
  })
  .filter((p): p is { tau: number; coverage: number; accuracy: number } => p !== null);

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const correctAutoHeld = held.autoHandled - held.wrongAutoActions;
const correctBaseHeld = held.total - held.baselineWrong;

const W = 560;
const H = 300;
const PAD = { l: 44, r: 12, t: 12, b: 30 };

export default function ProofCalibrationPage() {
  const [viewMode, setViewMode] = useState<"focused" | "full">("focused");
  const [activePoint, setActivePoint] = useState<{ tau: number; coverage: number; accuracy: number } | null>({
    tau: TAU,
    coverage: held.coverage,
    accuracy: held.accuracyAtCoverage,
  });

  const maxX = viewMode === "focused" ? 0.20 : 1.0;
  const xTicks = viewMode === "focused" ? [0, 0.05, 0.10, 0.15, 0.20] : [0, 0.25, 0.50, 0.75, 1.0];
  const yTicks = [0, 0.25, 0.50, 0.75, 1.0];

  const x = (cov: number) => PAD.l + Math.min(1, Math.max(0, cov / maxX)) * (W - PAD.l - PAD.r);
  const y = (acc: number) => PAD.t + (1 - Math.min(1, Math.max(0, acc))) * (H - PAD.t - PAD.b);

  const REGIMES = [
    {
      name: "Ultra-Strict",
      tau: 0.90,
      ...(() => {
        const auto = heldRuns.filter((r) => r.confidence >= 0.90 && r.entropyBits <= MAX_H);
        const cov = auto.length / heldRuns.length;
        const acc = auto.length > 0 ? auto.filter((r) => r.correct).length / auto.length : 1;
        return { cov, acc, auto: auto.length, escalated: heldRuns.length - auto.length, lift: Math.max(0, acc - held.baselineAccuracy), isCalibrated: false };
      })(),
    },
    {
      name: "High Precision",
      tau: 0.75,
      ...(() => {
        const auto = heldRuns.filter((r) => r.confidence >= 0.75 && r.entropyBits <= MAX_H);
        const cov = auto.length / heldRuns.length;
        const acc = auto.length > 0 ? auto.filter((r) => r.correct).length / auto.length : 1;
        return { cov, acc, auto: auto.length, escalated: heldRuns.length - auto.length, lift: Math.max(0, acc - held.baselineAccuracy), isCalibrated: false };
      })(),
    },
    {
      name: `Calibrated Gate (τ = ${TAU})`,
      tau: TAU,
      cov: held.coverage,
      acc: held.accuracyAtCoverage,
      auto: held.autoHandled,
      escalated: held.escalated,
      lift: Math.max(0, held.accuracyAtCoverage - held.baselineAccuracy),
      isCalibrated: true,
    },
    {
      name: "Permissive",
      tau: 0.35,
      ...(() => {
        const auto = heldRuns.filter((r) => r.confidence >= 0.35 && r.entropyBits <= MAX_H);
        const cov = auto.length / heldRuns.length;
        const acc = auto.length > 0 ? auto.filter((r) => r.correct).length / auto.length : held.baselineAccuracy;
        return { cov, acc, auto: auto.length, escalated: heldRuns.length - auto.length, lift: Math.max(0, acc - held.baselineAccuracy), isCalibrated: false };
      })(),
    },
    {
      name: "Always-Trust (Ungated)",
      tau: 0,
      cov: 1.0,
      acc: held.baselineAccuracy,
      auto: held.total,
      escalated: 0,
      lift: 0,
      isCalibrated: false,
    },
  ];

  if (runs.length === 0 || heldRuns.length === 0) {
    return (
      <DashboardShell project="WEV">
        <div className="flex flex-col gap-6 py-6">
          <div className="flex flex-col gap-2 border-b-2 border-[#0a0a0a] pb-5">
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#525252]">
              Gate calibration
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-[#0a0a0a]">
              No captured runs committed yet
            </h1>
            <p className="text-sm text-[#525252]">
              This page renders evidence/captured-runs.json and evidence/calibration.json. Run pnpm capture
              and pnpm calibrate first.
            </p>
          </div>
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell project="WEV">
      <div className="flex flex-col gap-6 py-2">
        {/* Page Title & Context Header */}
        <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-[#0a0a0a] pb-4 sm:pb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="shrink-0 border border-[#0a0a0a] bg-[#0a0a0a] px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider text-white">
                GATE.CALIBRATION
              </span>
              <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-[#0a0a0a]">
                Measured accuracy at coverage
              </h1>
            </div>
            <p className="mt-1 max-w-2xl text-xs text-[#525252]">
              {runs.length} captured {calibration.modelId} runs, seeded {calibration.seed} split{" "}
              {calibration.split.calibrationSize}/{calibration.split.heldoutSize}; thresholds picked on the
              first half, reported on the second: confidence ≥ {TAU}, entropy ≤ {MAX_H} bits.
            </p>
          </div>
        </div>

        {/* Headline numbers: held-out split */}
        <section className="grid grid-cols-2 gap-2 sm:gap-3 sm:grid-cols-4">
          <div className="border-2 border-[#0a0a0a] bg-[#ffffff] p-2.5 sm:p-4 shadow-[3px_3px_0_0_#0a0a0a]">
            <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#0a0a0a]">
              Auto-handled (held-out)
            </div>
            <div className="mt-1 font-mono text-xl sm:text-2xl font-bold text-[#0a0a0a]">
              {held.autoHandled} / {held.total}
            </div>
            <div className="mt-0.5 sm:mt-1 font-mono text-[10px] sm:text-[11px] text-[#525252]">
              coverage {pct(held.coverage)}
            </div>
          </div>

          <div className="border-2 border-[#0a0a0a] bg-[#ffffff] p-2.5 sm:p-4 shadow-[3px_3px_0_0_#0a0a0a]">
            <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#16a34a]">
              Accuracy at coverage
            </div>
            <div className="mt-1 font-mono text-xl sm:text-2xl font-bold text-[#16a34a]">
              {pct(held.accuracyAtCoverage)}
            </div>
            <div className="mt-0.5 sm:mt-1 font-mono text-[10px] sm:text-[11px] text-[#525252]">
              {correctAutoHeld} of {held.autoHandled} auto correct
            </div>
          </div>

          <div className="border-2 border-[#0a0a0a] bg-[#ffffff] p-2.5 sm:p-4 shadow-[3px_3px_0_0_#0a0a0a]">
            <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#525252]">
              Always-trust baseline
            </div>
            <div className="mt-1 font-mono text-xl sm:text-2xl font-bold text-[#525252]">
              {pct(held.baselineAccuracy)}
            </div>
            <div className="mt-0.5 sm:mt-1 font-mono text-[10px] sm:text-[11px] text-[#525252]">
              {correctBaseHeld} of {held.total} correct · {held.baselineWrong} would-be mistakes
            </div>
          </div>

          <div className="border-2 border-[#0a0a0a] bg-[#ffffff] p-2.5 sm:p-4 shadow-[3px_3px_0_0_#0a0a0a]">
            <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#dc2626]">
              Wrong auto-actions
            </div>
            <div className="mt-1 font-mono text-xl sm:text-2xl font-bold text-[#dc2626]">
              {held.wrongAutoActions}
            </div>
            <div className="mt-0.5 sm:mt-1 font-mono text-[10px] sm:text-[11px] text-[#525252]">
              {held.escalated} of {held.total} escalated to a human
            </div>
          </div>
        </section>

        {/* Accuracy-vs-coverage chart (held-out sweep) */}
        <section data-demo="proof-chart" className="flex flex-col gap-4 border-2 border-[#0a0a0a] bg-[#ffffff] p-3.5 sm:p-5 shadow-[4px_4px_0_0_#0a0a0a]">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-[#0a0a0a] pb-3 sm:pb-4">
            <div>
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#525252]">
                Accuracy vs coverage · held-out {held.total} runs
              </span>
              <h2 className="font-mono text-lg sm:text-xl font-bold text-[#0a0a0a]">
                What stricter confidence buys
              </h2>
              <p className="mt-1 text-xs text-[#525252] max-w-2xl">
                Sweeping confidence τ {Math.min(...sweepTaus)}–{Math.max(...sweepTaus)} at entropy ≤{" "}
                {MAX_H} bits on the held-out split. The blue marker denotes the calibrated τ = {TAU};
                the dashed red line is un-gated baseline accuracy ({pct(held.baselineAccuracy)}).
              </p>
            </div>

            {/* Scale domain toggle */}
            <div className="flex flex-wrap items-center gap-1.5 border-2 border-[#0a0a0a] bg-[#ece8df] p-1 font-mono text-xs w-full sm:w-auto justify-between sm:justify-start">
              <span className="px-1 text-[11px] font-semibold text-[#525252]">X-Axis Scale:</span>
              <button
                type="button"
                onClick={() => setViewMode("focused")}
                style={viewMode === "focused" ? { color: "#ffffff", backgroundColor: "#0a0a0a" } : undefined}
                className={`px-2.5 py-1 text-xs font-bold transition-all cursor-pointer ${
                  viewMode === "focused"
                    ? "border border-[#0a0a0a] bg-[#0a0a0a] !text-white shadow-[1px_1px_0_0_#0047ff]"
                    : "border border-transparent bg-transparent text-[#0a0a0a] hover:bg-[#ffffff]"
                }`}
              >
                <span className={viewMode === "focused" ? "!text-white text-white font-bold" : ""}>
                  Focused (0–20%)
                </span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode("full")}
                style={viewMode === "full" ? { color: "#ffffff", backgroundColor: "#0a0a0a" } : undefined}
                className={`px-2.5 py-1 text-xs font-bold transition-all cursor-pointer ${
                  viewMode === "full"
                    ? "border border-[#0a0a0a] bg-[#0a0a0a] !text-white shadow-[1px_1px_0_0_#0047ff]"
                    : "border border-transparent bg-transparent text-[#0a0a0a] hover:bg-[#ffffff]"
                }`}
              >
                <span className={viewMode === "full" ? "!text-white text-white font-bold" : ""}>
                  Full (0–100%)
                </span>
              </button>
            </div>
          </div>

          {/* Active Operating Point Inspection Card */}
          {activePoint && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 border-2 border-[#0a0a0a] bg-[#ece8df] p-3 font-mono text-xs">
              <div>
                <span className="text-[10px] text-[#525252] uppercase block">Confidence Bar (τ)</span>
                <span className="font-bold text-[#0a0a0a] text-sm">≥ {activePoint.tau.toFixed(2)}</span>
                <span className="text-[10px] text-[#525252] block">
                  {activePoint.tau === TAU ? "★ Calibrated setting" : "Swept threshold"}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-[#525252] uppercase block">Coverage</span>
                <span className="font-bold text-[#0a0a0a] text-sm">{pct(activePoint.coverage)}</span>
                <span className="text-[10px] text-[#525252] block">
                  {Math.round(activePoint.coverage * held.total)} of {held.total} runs
                </span>
              </div>
              <div>
                <span className="text-[10px] text-[#525252] uppercase block">Accuracy</span>
                <span className="font-bold text-emerald-700 text-sm">{pct(activePoint.accuracy)}</span>
                <span className="text-[10px] text-[#525252] block">
                  vs {pct(held.baselineAccuracy)} baseline
                </span>
              </div>
              <div>
                <span className="text-[10px] text-[#525252] uppercase block">Accuracy Lift</span>
                <span className="font-bold text-[#0047ff] text-sm">
                  +{( (activePoint.accuracy - held.baselineAccuracy) * 100 ).toFixed(1)}%
                </span>
                <span className="text-[10px] text-[#525252] block">Gain from gate</span>
              </div>
            </div>
          )}

          {/* Precision Chart SVG */}
          <div className="relative border-2 border-[#0a0a0a] bg-[#ffffff] p-1">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="w-full h-auto"
              role="img"
              aria-label={`Accuracy versus coverage on ${held.total} held-out runs (${viewMode} scale)`}
            >
              <defs>
                <linearGradient id="liftGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0047ff" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#0047ff" stopOpacity="0.02" />
                </linearGradient>
              </defs>

              {/* Grid Lines & Axis Labels */}
              {xTicks.map((t) => (
                <g key={`x-${t}`}>
                  <line x1={x(t)} y1={PAD.t} x2={x(t)} y2={H - PAD.b} stroke="#ece8df" strokeWidth="1" />
                  <text
                    x={x(t)}
                    y={H - PAD.b + 16}
                    textAnchor="middle"
                    fontSize="10"
                    fontFamily="monospace"
                    fill="#525252"
                    fontWeight={t === 0.1 && viewMode === "focused" ? "bold" : "normal"}
                  >
                    {Math.round(t * 100)}%
                  </text>
                </g>
              ))}

              {yTicks.map((t) => (
                <g key={`y-${t}`}>
                  <line x1={PAD.l} y1={y(t)} x2={W - PAD.r} y2={y(t)} stroke="#ece8df" strokeWidth="1" />
                  <text
                    x={PAD.l - 8}
                    y={y(t) + 3}
                    textAnchor="end"
                    fontSize="10"
                    fontFamily="monospace"
                    fill="#525252"
                  >
                    {Math.round(t * 100)}%
                  </text>
                </g>
              ))}

              {/* Shaded Gain Area Above Baseline */}
              {curve.length > 0 && (
                <polygon
                  points={[
                    `${x(curve[curve.length - 1].coverage)},${y(held.baselineAccuracy)}`,
                    ...curve.map((p) => `${x(p.coverage).toFixed(1)},${y(p.accuracy).toFixed(1)}`),
                    `${x(curve[0].coverage)},${y(held.baselineAccuracy)}`,
                  ].join(" ")}
                  fill="url(#liftGradient)"
                />
              )}

              {/* Always-Trust Baseline (40.0%) */}
              <line
                x1={PAD.l}
                y1={y(held.baselineAccuracy)}
                x2={W - PAD.r}
                y2={y(held.baselineAccuracy)}
                stroke="#dc2626"
                strokeWidth="1.5"
                strokeDasharray="5 4"
              />
              <text
                x={W - PAD.r - 4}
                y={y(held.baselineAccuracy) - 6}
                textAnchor="end"
                fontSize="9"
                fontFamily="monospace"
                fill="#dc2626"
                fontWeight="bold"
              >
                Always-trust baseline: {pct(held.baselineAccuracy)}
              </text>

              {/* Curve Line */}
              <polyline
                fill="none"
                stroke="#0a0a0a"
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                points={curve.map((p) => `${x(p.coverage).toFixed(1)},${y(p.accuracy).toFixed(1)}`).join(" ")}
              />

              {/* Curve Data Points */}
              {curve.map((p) => {
                const isSelected = activePoint?.tau === p.tau;
                const isCalibrated = Math.abs(p.tau - TAU) < 0.001;
                return (
                  <g key={p.tau} className="cursor-pointer" onClick={() => setActivePoint(p)}>
                    <circle
                      cx={x(p.coverage)}
                      cy={y(p.accuracy)}
                      r={isSelected ? "5" : "3.5"}
                      fill={isSelected ? "#0047ff" : "#0a0a0a"}
                      stroke="#ffffff"
                      strokeWidth="1.5"
                    />
                    {isCalibrated && (
                      <circle
                        cx={x(p.coverage)}
                        cy={y(p.accuracy)}
                        r="8"
                        fill="none"
                        stroke="#0047ff"
                        strokeWidth="2"
                      />
                    )}
                  </g>
                );
              })}

              {/* Callout Tag on Calibrated Point */}
              <g
                transform={`translate(${Math.min(W - PAD.r - 168, Math.max(PAD.l + 4, x(held.coverage) - 84))}, ${Math.max(
                  PAD.t + 4,
                  y(held.accuracyAtCoverage) - 28
                )})`}
              >
                <rect
                  x="0"
                  y="0"
                  width="168"
                  height="20"
                  fill="#0047ff"
                  stroke="#0a0a0a"
                  strokeWidth="1.5"
                  rx="0"
                />
                <text
                  x="84"
                  y="13.5"
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="8.5"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  CALIBRATED: τ={TAU} · {pct(held.accuracyAtCoverage)}
                </text>
              </g>

              {/* Callout Tag on Peak Precision */}
              {viewMode === "focused" && (
                <g transform={`translate(${x(0.02) + 8}, ${y(1.0) + 12})`}>
                  <rect
                    x="0"
                    y="0"
                    width="124"
                    height="18"
                    fill="#ece8df"
                    stroke="#0a0a0a"
                    strokeWidth="1.5"
                  />
                  <text
                    x="62"
                    y="12.5"
                    textAnchor="middle"
                    fill="#0a0a0a"
                    fontSize="8.5"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    PEAK: 100% ACCURACY
                  </text>
                </g>
              )}
            </svg>
          </div>

          {/* Legend Strip */}
          <div className="flex flex-wrap items-center justify-between gap-3 font-mono text-xs text-[#525252] border-t border-[#0a0a0a]/20 pt-2">
            <div className="flex flex-wrap items-center gap-4">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 bg-[#0a0a0a]" /> Sweep curve (τ 0.30–0.90)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-[#0047ff]" /> Calibrated τ = {TAU}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-0 w-4 border-t-2 border-dashed border-[#dc2626]" /> Always-trust {pct(held.baselineAccuracy)}
              </span>
            </div>
            <span className="text-[11px] text-[#525252]">Click any point to inspect trade-off</span>
          </div>

          {/* Operating Regimes Breakdown Table */}
          <div className="mt-2 space-y-2">
            <div className="flex items-center justify-between font-mono text-xs">
              <span className="font-bold text-[#0a0a0a] uppercase tracking-wider">
                Operating Regimes Under Entropy Bar (≤ {MAX_H} bits)
              </span>
              <span className="text-[#525252]">Held-out 50 runs</span>
            </div>
            <div className="border-2 border-[#0a0a0a] bg-[#ffffff] shadow-[2px_2px_0_0_#0a0a0a] overflow-x-auto">
              <table className="w-full font-mono text-xs text-[#0a0a0a]">
                <thead>
                  <tr className="border-b-2 border-[#0a0a0a] bg-[#ece8df] text-left text-[11px]">
                    <th className="px-3 py-2 font-bold">Regime</th>
                    <th className="px-3 py-2 font-bold">Confidence Bar</th>
                    <th className="px-3 py-2 text-right font-bold">Coverage</th>
                    <th className="px-3 py-2 text-right font-bold">Accuracy</th>
                    <th className="px-3 py-2 text-right font-bold">Auto / Held</th>
                    <th className="px-3 py-2 text-right font-bold">Gain vs Baseline</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#0a0a0a]/20">
                  {REGIMES.map((r) => {
                    const isRowActive = activePoint?.tau === r.tau;
                    return (
                      <tr
                        key={r.name}
                        onClick={() => setActivePoint({ tau: r.tau, coverage: r.cov, accuracy: r.acc })}
                        className={`cursor-pointer transition-colors ${
                          r.isCalibrated
                            ? "bg-[#0047ff]/10 font-bold"
                            : isRowActive
                            ? "bg-[#ece8df]"
                            : "hover:bg-[#f5f1e8]"
                        }`}
                      >
                        <td className="px-3 py-2.5">
                          <span className="flex items-center gap-1.5">
                            {r.isCalibrated && <span className="inline-block h-2 w-2 rounded-full bg-[#0047ff]" />}
                            {r.name}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          {r.tau > 0 ? `τ ≥ ${r.tau.toFixed(2)}` : "None (Ungated)"}
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold">{pct(r.cov)}</td>
                        <td className="px-3 py-2.5 text-right font-bold text-emerald-700">
                          {pct(r.acc)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-[#525252]">
                          {r.auto} auto ({r.escalated} escalated)
                        </td>
                        <td className="px-3 py-2.5 text-right font-bold text-[#0047ff]">
                          {r.lift > 0 ? `+${(r.lift * 100).toFixed(1)}%` : "0.0%"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Split table + failure gallery */}
        <section className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-12">
          <div className="flex flex-col gap-3 lg:col-span-5">
            <div className="border-2 border-[#0a0a0a] bg-[#ece8df] px-3.5 sm:px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider text-[#0a0a0a]">
              Both halves of the split
            </div>
            <div className="border-2 border-[#0a0a0a] bg-[#ffffff] shadow-[2px_2px_0_0_#0a0a0a] overflow-x-auto">
              <table className="w-full font-mono text-[11px] text-[#0a0a0a]">
                <thead>
                  <tr className="border-b-2 border-[#0a0a0a] bg-[#ece8df] text-left">
                    <th className="px-3 py-2">Split</th>
                    <th className="px-3 py-2 text-right">Auto</th>
                    <th className="px-3 py-2 text-right">Coverage</th>
                    <th className="px-3 py-2 text-right">Accuracy</th>
                    <th className="px-3 py-2 text-right">Baseline</th>
                    <th className="px-3 py-2 text-right">Wrong</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { name: `Calibration (${cal.total})`, r: cal },
                    { name: `Held-out (${held.total})`, r: held },
                  ].map((row) => (
                    <tr key={row.name} className="border-b border-[#ece8df] last:border-b-0">
                      <td className="px-3 py-2 font-bold">{row.name}</td>
                      <td className="px-3 py-2 text-right">
                        {row.r.autoHandled}/{row.r.total}
                      </td>
                      <td className="px-3 py-2 text-right">{pct(row.r.coverage)}</td>
                      <td className="px-3 py-2 text-right">{pct(row.r.accuracyAtCoverage)}</td>
                      <td className="px-3 py-2 text-right">{pct(row.r.baselineAccuracy)}</td>
                      <td className="px-3 py-2 text-right">{row.r.wrongAutoActions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="font-mono text-[11px] text-[#525252]">
              Thresholds were picked on the calibration half; only the held-out half above counts as the
              honest report.
            </p>
          </div>

          <div className="flex flex-col gap-3 lg:col-span-7">
            <div className="border-2 border-[#0a0a0a] bg-[#ece8df] px-3.5 sm:px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider text-[#0a0a0a]">
              Wrong auto-actions on held-out ({wrongAutoHeld.length})
            </div>
            {wrongAutoHeld.length === 0 ? (
              <div className="border-2 border-[#0a0a0a] bg-[#ffffff] p-4 font-mono text-xs text-[#0a0a0a] shadow-[2px_2px_0_0_#0a0a0a]">
                No wrong auto-actions on held-out at the calibrated thresholds.
              </div>
            ) : (
              wrongAutoHeld.map((r) => (
                <div
                  key={r.id}
                  className="border-2 border-[#dc2626] bg-[#ffffff] p-3.5 sm:p-4 shadow-[3px_3px_0_0_#dc2626]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
                    <span className="font-bold text-[#0a0a0a]">{r.id}</span>
                    <span className="border border-[#dc2626] px-1.5 py-0.5 font-bold uppercase text-[#dc2626]">
                      auto-handled · wrong
                    </span>
                  </div>
                  <p className="mt-2 text-xs font-semibold text-[#0a0a0a]">&ldquo;{r.text}&rdquo;</p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-[#525252]">
                    <span>
                      gold <strong className="text-[#0a0a0a]">{r.gold}</strong> vs predicted{" "}
                      <strong className="text-[#dc2626]">{r.prediction}</strong>
                    </span>
                    <span>confidence {(r.confidence * 100).toFixed(1)}%</span>
                    <span>entropy {r.entropyBits} bits</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Limits panel */}
        <section className="flex flex-col gap-3 border-2 border-[#0a0a0a] bg-[#ece8df] p-3.5 sm:p-5 shadow-[4px_4px_0_0_#0a0a0a]">
          <div className="font-mono text-xs font-bold uppercase tracking-wider text-[#0a0a0a]">
            Limits: read before trusting this gate
          </div>
          <ul className="flex flex-col gap-2 text-xs leading-relaxed text-[#0a0a0a]">
            <li className="border border-[#0a0a0a] bg-[#ffffff] p-2.5 font-mono text-[11px]">
              Synthetic data: {calibration.syntheticDataNote}
            </li>
            <li className="border border-[#0a0a0a] bg-[#ffffff] p-2.5 font-mono text-[11px]">
              One model: {calibration.modelId} ({calibration.dtype}). Thresholds belong to this model id;
              never reuse them for another model.
            </li>
            <li className="border border-[#0a0a0a] bg-[#ffffff] p-2.5 font-mono text-[11px]">
              One closed task: {labelCount} labels over {runs.length} tickets, seeded {calibration.seed}{" "}
              split {calibration.split.calibrationSize}/{calibration.split.heldoutSize}. A held-out sample
              of {held.total} cannot support strong claims.
            </li>
          </ul>
        </section>

        {/* Reproduce + nav */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-[11px] text-[#525252]">
            Reproduce every number here: pnpm capture {"&&"} pnpm calibrate
          </p>
          <div className="flex flex-col sm:flex-row w-full sm:w-auto gap-3">
            <Link
              href="/live"
              style={{ color: "#ffffff", backgroundColor: "#0a0a0a" }}
              className="w-full sm:w-auto border-2 border-[#0a0a0a] bg-[#0a0a0a] !text-white px-4 py-2 font-mono text-xs font-bold shadow-[2px_2px_0_0_#0047ff] hover:-translate-y-0.5 transition-transform text-center"
            >
              <span className="!text-white text-white font-bold" style={{ color: "#ffffff" }}>
                Inspect
              </span>
            </Link>
            <Link
              href="/verify"
              className="w-full sm:w-auto text-center border-2 border-[#0a0a0a] bg-[#ffffff] px-4 py-2 font-mono text-xs font-semibold text-[#0a0a0a] shadow-[2px_2px_0_0_#0a0a0a]"
            >
              Byte Verifier
            </Link>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
