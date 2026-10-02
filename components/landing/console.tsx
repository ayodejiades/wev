"use client";

// components/landing/console.tsx — the wev console: the landing's live product surface.
//
// Windows on one dithered ground, composed like a small desktop: a cluster of
// decision-kind filters, the committed case table with a probability scale, the
// selected case's readout, a clock, the invariant cells and the version plate. The
// composition is borrowed from a late-80s TUI desktop because that is what this
// product is — a handful of instruments you watch while a model talks.
//
// Every number here is computed in the browser by `evaluateDeterministicKernel()`
// (lib/kernel.ts) from the cases committed to evidence/campaign-report.json — the
// same kernel and the same fixtures that /proof, /verify and `pnpm claim:verify`
// run. Nothing is typed in: filter a window, pick a case, and the bars, the entropy,
// the margin and the invariant cells all move because the code recomputed them.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import campaignData from "@/evidence/campaign-report.json";
import {
  evaluateDeterministicKernel,
  type DecisionKind,
  type InspectorInput,
  type InspectorState,
} from "@/lib/kernel";
import type { DecisionState } from "@/lib/landing";
import "./console.css";

type FixtureCase = InspectorInput & {
  title: string;
  category: string;
  expectedState: string;
  display?: { title?: string; verdict?: string; reason?: string };
};

const CASES = campaignData.cases as FixtureCase[];

/** The decision kinds lib/kernel.ts reads that have active fixtures. */
const KINDS: { kind: DecisionKind; label: string; blurb: string }[] = [
  { kind: "tokens", label: "TOKENS", blurb: "next-token candidates" },
  { kind: "choice", label: "CHOICE", blurb: "pick one option" },
  { kind: "score", label: "SCORE", blurb: "ordered levels" },
];

/** Kernel verdict -> the product's four words (brief.json landing.stateLabels). */
const VERDICT_STATE: Record<InspectorState, DecisionState> = {
  CONFIDENT_CONTINUE: "clear",
  BENIGN_CONTROL_DOMINANT: "clear",
  UNCERTAIN_FLAG: "flagged",
  ABSTAIN_FLAT_DISTRIBUTION: "refused",
  ABSTAIN_INVALID_DISTRIBUTION: "refused",
};

const pct = (p: number) => `${(p * 100).toFixed(1)}%`;
const clampMark = (p: number) => `calc(${Math.min(1, Math.max(0, p))} * (100% - 9px))`;

/** Local wall clock, read only on the client so the server render stays static. */
function useNow() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function Console({
  name,
  trust,
  stateLabels,
  fixturePath,
}: {
  name: string;
  trust: string[];
  stateLabels: Record<DecisionState, string>;
  fixturePath: string;
}) {
  const now = useNow();
  const [kind, setKind] = useState<DecisionKind | "all">("all");
  const [selectedId, setSelectedId] = useState<string>(CASES[0]?.caseId ?? "");

  // The measurement happens here, in the browser, from the committed fixtures.
  const rows = useMemo(
    () =>
      CASES.map((c) => {
        const decision = evaluateDeterministicKernel(c);
        return {
          c,
          decision,
          // Mass the top two hold: what the runner-up needs to overtake the leader.
          topTwo: decision.topProb + (c.candidates[1]?.prob ?? 0),
          state: VERDICT_STATE[decision.state],
        };
      }),
    [],
  );

  // No committed case means no console: every number on it comes from the fixture, so
  // there is nothing honest left to draw.
  if (!rows.length) return null;

  const visible = kind === "all" ? rows : rows.filter((r) => r.decision.kind === kind);
  const active = visible.find((r) => r.c.caseId === selectedId) ?? visible[0] ?? null;

  function pickKind(next: DecisionKind | "all") {
    setKind(next);
    const first = next === "all" ? rows[0] : rows.find((r) => r.decision.kind === next);
    if (first) setSelectedId(first.c.caseId);
  }

  const held = active ? active.decision.invariants.filter((i) => i.passed).length : 0;

  return (
    <section aria-labelledby="console-heading" className="mx-auto mt-4 w-full max-w-6xl scroll-mt-20 px-3 sm:mt-6 sm:px-6">
      <div className="mb-3.5">
        <h2 id="console-heading" className="lp-display text-3xl text-[var(--ink)] sm:text-4xl">
          The console
        </h2>
      </div>
      <figure className="wev-console">
        <span className="wev-plate" aria-hidden="true">
          {name}.OS 0.1
        </span>

        <div className="wev-console__grid">
          {/* 1. The decision-kind filters: three clean windows side by side. */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3 lg:col-span-8 lg:col-start-1 lg:row-start-1">
            {KINDS.map((k, i) => {
              const count = rows.filter((r) => r.decision.kind === k.kind).length;
              const on = kind === k.kind;
              return (
                <button
                  key={k.kind}
                  type="button"
                  onClick={() => pickKind(on ? "all" : k.kind)}
                  aria-pressed={on}
                  title={`${k.blurb}: ${count} committed ${count === 1 ? "case" : "cases"}`}
                  className="wev-win flex flex-col justify-between"
                >
                  <span className="wev-win__bar">
                    <span>{k.kind}</span>
                    <span aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                  </span>
                  <span className="wev-win__body text-center flex flex-col items-center justify-center p-2 sm:p-3">
                    <span className="wev-stamp text-sm sm:text-lg">{k.label}</span>
                    <span className="mt-1 hidden sm:block text-[11px] leading-tight text-[var(--muted)]">{k.blurb}</span>
                    <span className="wev-tag mt-1 sm:mt-2 text-[9px] sm:text-[10px]">
                      +{count} {count === 1 ? "case" : "cases"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* 2. Clock. */}
          <div className="lg:col-span-3 lg:col-start-10 lg:row-start-1 lg:justify-self-end">
            <div className="wev-win">
              <div className="wev-win__bar">
                <span>Clock 1.1</span>
              </div>
              <div className="wev-win__body">
                <p className="text-[11px] leading-tight text-[var(--muted)]">
                  {now
                    ? now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", year: "numeric" })
                    : "Your own machine"}
                </p>
                <p className="lp-mono mt-1 text-xl" suppressHydrationWarning>
                  {now ? now.toLocaleTimeString("en-GB", { hour12: false }) : "--:--:--"}
                </p>
                <p className="mt-2 text-[11px] leading-tight text-[var(--muted)]">
                  Inference runs in this tab. Nothing is sent anywhere.
                </p>
              </div>
            </div>
          </div>
          {/* 3. The table. One row per committed case, ordered by fixture id. */}
          <div className="lg:col-span-8 lg:col-start-1 lg:row-start-2">
            <div className="wev-win">
              <div className="wev-win__bar">
                <span>Kernel 1.1</span>
                <span>
                  {visible.length} / {CASES.length} cases
                </span>
              </div>
              <div className="wev-win__body overflow-x-auto">
                {visible.length ? (
                  <table className="w-full border-collapse text-left text-sm">
                    <caption className="sr-only">
                      Every committed case with the kernel&apos;s top-token probability, its margin over the
                      runner-up, and the verdict the deterministic code returned.
                    </caption>
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
                        <th scope="col" className="pb-2 font-normal">Case</th>
                        <th scope="col" className="pb-2 text-right font-normal">Top-1</th>
                        <th scope="col" className="hidden pb-2 text-right font-normal sm:table-cell">Margin</th>
                        <th scope="col" className="pb-2 pl-3 font-normal">Verdict</th>
                        <th scope="col" className="hidden pb-2 pl-3 font-normal sm:table-cell">Mass</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((r) => {
                        const on = active?.c.caseId === r.c.caseId;
                        return (
                          <tr
                            key={r.c.caseId}
                            className="border-t border-[color-mix(in_oklab,var(--ink)_20%,transparent)]"
                          >
                            <th scope="row" className="py-2 pr-2 font-normal">
                              <button
                                type="button"
                                onClick={() => setSelectedId(r.c.caseId)}
                                aria-pressed={on}
                                className="wev-stamp text-[11px]"
                              >
                                {r.c.caseId}
                              </button>
                            </th>
                            <td className="lp-mono py-2 text-right text-[12px]">{pct(r.decision.topProb)}</td>
                            <td className="lp-mono hidden py-2 text-right text-[12px] text-[var(--muted)] sm:table-cell">
                              {r.decision.margin.toFixed(3)}
                            </td>
                            <td className="py-2 pl-3">
                              <span className="lp-state text-[11px]" data-state={r.state}>
                                {stateLabels[r.state]}
                              </span>
                            </td>
                            <td className="hidden py-2 pl-3 sm:table-cell">
                              <span
                                className="wev-scale block w-full min-w-[7rem]"
                                aria-hidden="true"
                                title={`Top-1: ${pct(r.decision.topProb)} | Top-2 combined: ${pct(r.topTwo)}`}
                              >
                                <span className="wev-scale__mid" />
                                <span
                                  className="wev-scale__runner-band"
                                  style={{
                                    left: `calc(${Math.min(1, r.decision.topProb)} * (100% - 9px))`,
                                    width: `calc(${Math.max(0, Math.min(1, r.topTwo) - Math.min(1, r.decision.topProb))} * (100% - 9px))`,
                                  }}
                                />
                                <span className="wev-scale__axis" />
                                <span
                                  className="wev-scale__mark wev-scale__mark--top"
                                  style={{ left: clampMark(r.decision.topProb) }}
                                />
                                <span
                                  className="wev-scale__mark wev-scale__mark--second"
                                  style={{ left: clampMark(r.topTwo) }}
                                />
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <p className="wev-dither border-2 border-[var(--ink)] px-4 py-6 text-center text-sm text-[var(--ink)]">
                    No committed case uses this decision kind yet. The kernel will not draw a bar for a
                    decision nobody has measured.
                  </p>
                )}

                <p className="mt-3 text-[11px] leading-snug text-[var(--muted)]">
                  Filled mark: top token mass. Hollow mark: top two combined. Center line: 50% majority threshold.
                  A narrow gap between marks indicates model hesitation.
                </p>

                <Link
                  href="/live"
                  className="wev-dither mt-3 flex items-center gap-3 border-2 border-[var(--ink)] px-4 py-3 text-sm text-[var(--ink)]"
                >
                  <span>Run your own prompt through the kernel</span>
                </Link>
              </div>
            </div>
          </div>
          {/* 4. The readout: what the selected case actually looked like. */}
          <div className="lg:col-span-4 lg:col-start-9 lg:row-start-2 lg:justify-self-end lg:self-start">
            <div className="wev-win">
              <div className="wev-win__bar">
                <span>Readout 1.1</span>
                <span>{active?.c.caseId ?? "--"}</span>
              </div>
              <div className="wev-win__body">
                {active ? (
                  <>
                    <p className="text-[11px] uppercase tracking-wider text-[var(--muted)]">Prompt</p>
                    <p className="lp-mono mt-1 text-[13px] leading-snug text-[var(--ink)]">{active.c.prompt}</p>

                    <p className="mt-4 text-[11px] uppercase tracking-wider text-[var(--muted)]">Candidates</p>
                    <ul className="mt-2 flex flex-col gap-1.5">
                      {active.c.candidates.map((cand) => (
                        <li key={cand.token} className="flex items-center gap-2">
                          <span className="lp-mono w-16 sm:w-20 flex-none truncate text-[12px] text-[var(--ink)]">
                            {cand.token}
                          </span>
                          <span className="wev-meter flex-1">
                            <span className="wev-meter__fill" style={{ width: `${Math.min(100, cand.prob * 100)}%` }} />
                          </span>
                          <span className="lp-mono w-12 flex-none text-right text-[11px] text-[var(--muted)]">
                            {pct(cand.prob)}
                          </span>
                        </li>
                      ))}
                    </ul>

                    <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 border-t-2 border-[var(--ink)] pt-3 text-[12px]">
                      <div>
                        <dt className="text-[11px] text-[var(--muted)]">Entropy</dt>
                        <dd className="lp-mono">{active.decision.entropyBits.toFixed(2)} bits</dd>
                      </div>
                      <div>
                        <dt className="text-[11px] text-[var(--muted)]">Top-1 / top-2</dt>
                        <dd className="lp-mono">{pct(active.decision.topProb)} / {pct(active.c.candidates[1]?.prob ?? 0)}</dd>
                      </div>
                      {active.decision.expectedValue !== null ? (
                        <div>
                          <dt className="text-[11px] text-[var(--muted)]">Expected level</dt>
                          <dd className="lp-mono">{active.decision.expectedValue.toFixed(2)}</dd>
                        </div>
                      ) : null}
                      {/* The machine code is the longest string on screen, so it gets its own row
                          rather than breaking mid-token. */}
                      <div className="col-span-2">
                        <dt className="text-[11px] text-[var(--muted)]">Verdict</dt>
                        <dd className="lp-mono break-words">{active.decision.state}</dd>
                      </div>
                    </dl>

                    <p className="mt-3 text-[12px] leading-relaxed text-[var(--muted)]">
                      {active.c.display?.reason ?? active.decision.summary}
                    </p>

                    <Link
                      href="/live"
                      className="lp-mono mt-3 inline-block border-2 border-[var(--ink)] px-3 py-1.5 text-[11px] text-[var(--ink)] hover:bg-[var(--raised)]"
                    >
                      score your own prompt on /live
                    </Link>
                  </>
                ) : (
                  <p className="text-[12px] text-[var(--muted)]">Select a case to read its distribution.</p>
                )}
              </div>
            </div>
          </div>

          {/* 5. Version plate. */}
          <div className="lg:col-span-3 lg:col-start-1 lg:row-start-3 lg:self-end">
            <div className="wev-win">
              <div className="wev-win__bar">
                <span>{name}</span>
                <span>0.1</span>
              </div>
              <div className="wev-win__body">
                <p className="lp-mono text-[12px] text-[var(--ink)]">lib/kernel.ts</p>
                <p className="mt-1 text-[11px] leading-tight text-[var(--muted)]">
                  {trust.length ? trust.join(". ") + "." : "Runs on your device."}
                </p>
              </div>
            </div>
          </div>

          {/* 6. The five kernel invariants, as cells, for the case you picked. */}
          <div className="lg:col-span-3 lg:col-start-10 lg:row-start-3 lg:justify-self-end lg:self-end">
            <div className="wev-win">
              <div className="wev-win__bar">
                <span>Invariants 1.1</span>
              </div>
              <div className="wev-win__body">
                <ul className="wev-cells">
                  {(active?.decision.invariants ?? []).map((inv) => (
                    <li
                      key={inv.id}
                      className="wev-cell"
                      data-passed={inv.passed}
                      title={`${inv.id} ${inv.name}: ${inv.detail}`}
                    >
                      {inv.id.replace("INV-", "#")}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] leading-tight text-[var(--muted)]">
                  {held} / {active?.decision.invariants.length ?? 0} held on {active?.c.caseId ?? "--"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </figure>

      {/* Provenance sits on the page ground, not on the console's accent field, so it keeps
          the page's muted-ink contrast. */}
      <p className="mt-3.5 max-w-[72ch] text-sm leading-relaxed text-[var(--muted)]">
        Every figure in those windows is recomputed in your browser by{" "}
        <span className="lp-mono text-[var(--ink)]">lib/kernel.ts</span> from the cases committed to{" "}
        <span className="lp-mono text-[var(--ink)]">{fixturePath}</span>. The same kernel{" "}
        <span className="lp-mono">pnpm claim:verify</span> runs. No server is involved: the measured gate is on{" "}
        <Link href="/proof" className="underline decoration-2 underline-offset-2 hover:text-[var(--ink)]">
          /proof
        </Link>
        .
      </p>
    </section>
  );
}
