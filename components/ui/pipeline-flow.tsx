"use client";

import { useEffect, useState } from "react";

export interface PipelineStage {
  id: string;
  name: string;
  subtext: string;
  status: "idle" | "active" | "verified";
  metric?: string;
}

export function PipelineFlow({
  title = "Deterministic Triage Pipeline",
  subtitle = "Each stage an item passes through, from on-device logits to hashed receipt.",
  stages = [
    {
      id: "inspect",
      name: "01 Inspect",
      subtext: "On-device SmolLM2 logits",
      status: "verified",
      metric: "0 API CALLS",
    },
    {
      id: "decide",
      name: "02 Decide",
      subtext: "Closed-label probabilities",
      status: "verified",
      metric: "TYPED ARGMAX",
    },
    {
      id: "calibrate",
      name: "03 Calibrate",
      subtext: "50/50 held-out split bar",
      status: "verified",
      metric: "MEASURED τ",
    },
    {
      id: "gate",
      name: "04 Gate",
      subtext: "Deterministic kernel invariants",
      status: "active",
      metric: "AUTO / ESCALATE",
    },
    {
      id: "receipt",
      name: "05 Receipt",
      subtext: "SHA-256 hashed audit log",
      status: "verified",
      metric: "TAMPER-EVIDENT",
    },
  ],
  className = "",
}: {
  title?: string;
  subtitle?: string;
  stages?: PipelineStage[];
  className?: string;
}) {
  const [pulseIndex, setPulseIndex] = useState(1);

  useEffect(() => {
    const timer = setInterval(() => {
      setPulseIndex((prev) => (prev + 1) % stages.length);
    }, 2400);
    return () => clearInterval(timer);
  }, [stages.length]);

  return (
    <div
      className={`relative w-full overflow-hidden rounded-[var(--radius)] border border-[var(--border,#262626)] bg-[var(--surface,#121212)] p-6 shadow-[var(--shadow)] ${className}`}
    >
      {/* Background Grid Pattern — the same 1px dot screen the landing console uses, so the
          instrument reads as part of one product and no gradient is needed for texture. */}
      <div className="absolute inset-0 bg-[image:var(--wev-dot)] opacity-60 pointer-events-none" />

      {/* Header */}
      <div className="relative mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-[var(--border,#262626)] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <h3 className="text-sm font-semibold tracking-tight text-[var(--fg,#ededed)] font-mono uppercase">
              {title}
            </h3>
          </div>
          <p className="text-xs text-[var(--fg-muted,#888)] mt-0.5">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px] text-[var(--fg-muted,#888)]">
          <span className="rounded bg-[var(--surface-raised,#1f1f1f)] px-2 py-0.5 border border-[var(--border,#262626)]">
            LIVE MONITOR
          </span>
        </div>
      </div>

      {/* Interactive Architecture Flow */}
      <div className="relative flex flex-col md:flex-row items-center justify-between gap-4 py-4">
        {stages.map((stage, idx) => {
          const isPulsing = pulseIndex === idx;
          return (
            <div key={stage.id} className="relative z-10 flex flex-1 flex-col items-center w-full">
              {/* Card Node */}
              <div
                className={`relative w-full border-2 border-[var(--ink)] p-4 transition-all duration-500 ${
                  isPulsing
                    ? "bg-[var(--surface-raised)] shadow-[var(--shadow)]"
                    : "bg-[var(--surface)]"
                }`}
              >
                {/* Top Badge */}
                <div className="flex items-center justify-between text-xs font-mono text-[var(--fg-muted,#888)] mb-2">
                  <span>{String(idx + 1).padStart(2, "0")}</span>
                  {stage.metric && (
                    <span className="text-[10px] text-emerald-700 font-semibold bg-emerald-950/40 border border-emerald-800/60 rounded px-1.5 py-0.2">
                      {stage.metric}
                    </span>
                  )}
                </div>

                {/* Node Title & Subtitle */}
                <div className="text-sm font-medium text-[var(--fg,#ededed)] tracking-tight">
                  {stage.name}
                </div>
                <div className="text-xs text-[var(--fg-muted,#888)] mt-0.5 font-mono">
                  {stage.subtext}
                </div>

                {/* Status Indicator */}
                <div className="mt-3 flex items-center gap-1.5 text-[11px] text-[var(--fg-muted,#888)]">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      isPulsing
                        ? "bg-[var(--accent,#0047FF)] animate-ping"
                        : "bg-emerald-500"
                    }`}
                  />
                  <span className="font-mono uppercase text-[10px]">
                    {isPulsing ? "Processing..." : "Ready"}
                  </span>
                </div>
              </div>

              {/* Connecting Line (for mobile) */}
              {idx < stages.length - 1 && (
                <div className="md:hidden h-6 w-0.5 bg-[var(--border,#262626)] my-1" />
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom Telemetry Ticker */}
      <div className="relative mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-t border-[var(--border,#262626)] pt-3 text-[11px] font-mono text-[var(--fg-muted,#888)]">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <span>PIPELINE: DETERMINISTIC</span>
          <span className="text-[var(--border,#262626)]">|</span>
          <span>SLA: 99.99%</span>
        </div>
        <div className="text-emerald-700 font-semibold">ALL INVARIANTS SATISFIED</div>
      </div>
    </div>
  );
}
