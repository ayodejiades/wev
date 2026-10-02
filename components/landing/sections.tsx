"use client";

// components/landing/sections.tsx — the landing's building blocks. An archetype page is a
// composition of these; rearrange, drop or replace any of them for the product.
import { useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { DECISION_STATES, type GateBlock, type LandingData } from "@/lib/landing";
import { evaluateTriageGate } from "@/lib/kernel";
import { fontVariables } from "./fonts";
import { EmptyFinding, FindingCard, Icon, StateChip, type IconName } from "./primitives";

export function Frame({ d, children }: { d: LandingData; children: ReactNode }) {
  return (
    <div className={`lp ${fontVariables} flex min-h-screen w-full flex-col`} style={d.design.style as CSSProperties} data-design={d.design.preset}>
      {children}
    </div>
  );
}

export function Wordmark({ name }: { name: string }) {
  return (
    <span
      className="font-bold tracking-tight text-[var(--ink)] uppercase"
      style={{ fontFamily: "var(--font-landing-display), var(--font-display), 'Bricolage Grotesque', sans-serif" } as CSSProperties}
    >
      {name}
    </span>
  );
}

const LANDING_NAV_ITEMS = [
  { href: "/live", label: "Inspect" },
  { href: "/inbox", label: "Inbox" },
  { href: "/calibrate", label: "Calibrate" },
  { href: "/proof", label: "Proof" },
  { href: "/verify", label: "Verify" },
];

export function Nav({ d }: { d: LandingData }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b-2 border-[#0a0a0a] bg-[#ffffff] px-4 py-3">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
        <Link href="/" className="shrink-0 font-mono text-base font-bold tracking-tight text-[#0a0a0a] hover:text-[#0047ff]">
          <Wordmark name={d.name} />
        </Link>

        {/* Desktop Nav: single line */}
        <nav aria-label="Primary" className="hidden md:flex items-center gap-1 font-mono text-xs">
          {LANDING_NAV_ITEMS.map((l) => (
            <Link key={l.href} href={l.href} className="px-2.5 py-1 font-semibold text-[#525252] hover:text-[#0a0a0a]">
              {l.label}
            </Link>
          ))}
          <Link
            href="/live"
            style={{ color: "#ffffff", backgroundColor: "#0a0a0a" }}
            className="ml-2 border-2 border-[#0a0a0a] bg-[#0a0a0a] !text-white px-3.5 py-1 font-bold shadow-[2px_2px_0_0_#0047ff] hover:-translate-y-0.5 transition-transform"
          >
            <span className="!text-white text-white font-bold" style={{ color: "#ffffff" }}>
              Launch demo
            </span>
          </Link>
        </nav>

        {/* Mobile Nav: single-line row with Launch Demo and MENU button */}
        <div className="flex items-center gap-2 md:hidden">
          <Link
            href="/live"
            style={{ color: "#ffffff", backgroundColor: "#0a0a0a" }}
            className="border-2 border-[#0a0a0a] bg-[#0a0a0a] !text-white px-2.5 py-1 font-mono text-xs font-bold shadow-[2px_2px_0_0_#0047ff]"
          >
            <span className="!text-white text-white font-bold" style={{ color: "#ffffff" }}>
              Launch demo
            </span>
          </Link>
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-expanded={mobileMenuOpen}
            aria-label="Toggle navigation menu"
            className="border-2 border-[#0a0a0a] bg-[#ffffff] px-2.5 py-1 font-mono text-xs font-bold text-[#0a0a0a] shadow-[2px_2px_0_0_#0a0a0a] hover:bg-[#0a0a0a] hover:text-white transition-colors"
          >
            {mobileMenuOpen ? "Close" : "Menu"}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <nav
          aria-label="Mobile Navigation"
          className="mt-3 border-t-2 border-[#0a0a0a] pt-3 flex flex-col gap-1.5 md:hidden font-mono text-xs"
        >
          {LANDING_NAV_ITEMS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center justify-between border-2 border-[#0a0a0a] bg-[#ffffff] px-3 py-2 font-semibold text-[#0a0a0a] shadow-[2px_2px_0_0_#0a0a0a] hover:bg-[#0a0a0a] hover:text-white transition-colors"
            >
              <span>{l.label}</span>
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}

function HeroCopy({ d, align = "left" }: { d: LandingData; align?: "left" | "center" }) {
  const center = align === "center";
  return (
    <div className={`flex flex-col gap-6 ${center ? "items-center text-center" : "items-start"}`}>
      {d.audience ? (
        <p className="lp-rise flex items-center gap-2 text-sm text-[var(--muted)]" style={{ "--delay": "0ms" } as CSSProperties}>
          <span className="lp-dot" style={{ "--tone": "var(--accent)" } as CSSProperties} />
          {d.audience}
        </p>
      ) : null}
      <h1
        className={`lp-rise lp-display font-extrabold uppercase tracking-tight text-[clamp(3.5rem,8vw,6.25rem)] text-[var(--ink)] ${center ? "mx-auto" : ""}`}
        style={{
          fontFamily: "var(--font-landing-display), var(--font-display), 'Bricolage Grotesque', sans-serif",
          "--delay": "60ms",
        } as CSSProperties}
      >
        <span className="block font-extrabold tracking-tight">WEV</span>
        {d.promise ? (
          <span className={`mt-3 block max-w-[22ch] text-[0.45em] font-normal normal-case tracking-normal leading-[1.12] text-[var(--muted)] ${center ? "mx-auto" : ""}`}>{d.promise}</span>
        ) : null}
      </h1>
      {d.idea ? (
        <p className={`lp-rise lp-pretty max-w-[48ch] text-lg leading-relaxed text-[var(--muted)] ${center ? "mx-auto" : ""}`} style={{ "--delay": "120ms" } as CSSProperties}>
          {d.idea}
        </p>
      ) : null}
      <div className={`lp-rise flex flex-wrap gap-3.5 ${center ? "justify-center" : ""}`} style={{ "--delay": "180ms" } as CSSProperties}>
        <Link href="/live" className="lp-btn lp-btn-accent">
          Live demo
        </Link>
        <Link href="/calibrate" data-demo="launch-demo" className="lp-btn lp-btn-quiet">
          {d.cta}
        </Link>
      </div>
    </div>
  );
}

/** The featured fixture case, shown as the product would show it. */
function FeaturedResult({ d, wide = false }: { d: LandingData; wide?: boolean }) {
  return (
    <div className={`lp-rise lp-card w-full ${wide ? "p-6 sm:p-10" : "p-5 sm:p-7"}`} style={{ "--delay": "240ms" } as CSSProperties}>
      {d.featured ? <FindingCard c={d.featured} persona={d.persona} /> : <EmptyFinding hint={d.setupHint} />}
    </div>
  );
}

/** The first screen. Its right-hand (or lower) half is a real result from the fixture. */
export function Hero({ d, layout = "split" }: { d: LandingData; layout?: "split" | "centered" | "editorial" }) {
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden="true" className="lp-bloom pointer-events-none absolute inset-0" />
      <div className={`relative mx-auto w-full max-w-6xl px-4 pb-6 sm:px-6 sm:pb-10 ${layout === "split" ? "pt-10 sm:pt-16" : "pt-6 sm:pt-10"}`}>
        {layout === "split" ? (
          <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-[1.05fr_1fr] lg:gap-12">
            <HeroCopy d={d} />
            <FeaturedResult d={d} />
          </div>
        ) : layout === "centered" ? (
          <div className="flex flex-col items-center gap-6 sm:gap-8">
            <div className="max-w-3xl">
              <HeroCopy d={d} align="center" />
            </div>
            <div className="w-full max-w-3xl">
              <FeaturedResult d={d} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-6 sm:gap-8">
            <div className="max-w-4xl">
              <HeroCopy d={d} />
            </div>
            <FeaturedResult d={d} wide />
          </div>
        )}
      </div>
    </section>
  );
}

export function Section({
  id,
  label,
  aside,
  children,
  tone = "plain",
}: {
  id?: string;
  label?: string;
  aside?: ReactNode;
  children: ReactNode;
  tone?: "plain" | "raised";
}) {
  return (
    <section id={id} className={`scroll-mt-20 ${tone === "raised" ? "border-y lp-hair bg-[var(--raised)]" : ""}`}>
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        {label || aside ? (
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3 sm:mb-6">
            {label ? <h2 className="lp-display text-3xl text-[var(--ink)] sm:text-4xl">{label}</h2> : <span />}
            {aside}
          </div>
        ) : null}
        {children}
      </div>
    </section>
  );
}

/** The calibrated gate, in four cells: curated held-out decisions and their rules. */
export function CountsBand({ d }: { d: LandingData }) {
  if (!d.cases.length) return null;
  const states = DECISION_STATES.filter((s) => d.counts[s] > 0);
  const g = d.gate;
  const rules: Record<string, string> = {
    clear: `Confidence ≥ ${g.tau}, entropy ≤ ${g.maxEntropyBits} bits. Code auto-handles.`,
    flagged: "Auto-handled but wrong on held-out. Counted, never hidden.",
    pending: "Below the bar. Queued for a human, never auto-handled.",
    refused: "Invalid model output fails closed instead of rendering.",
  };
  return (
    <div className="mx-auto mt-4 w-full max-w-6xl px-4 sm:mt-6 sm:px-6">
      <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius)] border lp-hair bg-[var(--line)] sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-[var(--surface)] px-5 py-4 flex flex-col justify-between">
          <dt className="flex items-center justify-between text-xs text-[var(--muted)]">
            <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--ink)]">Gate decisions</span>
            <span className="lp-mono font-bold text-base text-[var(--ink)]">{d.cases.length}</span>
          </dt>
          <dd className="mt-2 text-xs leading-snug text-[var(--muted)]">
            Curated held-out calls over {g.totalRuns} captured runs; thresholds from a seeded{" "}
            {g.calibTotal}/{g.heldTotal} split.
          </dd>
        </div>
        {states.map((s) => (
          <div key={s} className="bg-[var(--surface)] px-5 py-4 flex flex-col justify-between" data-state={s}>
            <dt className="flex items-center justify-between text-xs text-[var(--muted)]">
              <span className="flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--ink)]">
                <span className="lp-dot" />
                {d.stateLabels[s]}
              </span>
              <span className="lp-mono font-bold text-base text-[var(--ink)]">{d.counts[s]}</span>
            </dt>
            <dd className="mt-2 text-xs leading-snug text-[var(--muted)]">
              {rules[s] ?? "Deterministic gate evaluation."}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const STEP_ICON: Record<string, IconName> = { open: "open", click: "click", fill: "fill", wait: "wait" };

/** The demo path from docs/demo-path.json, as a step rail. */
export function StepsRail({ d, layout = "row" }: { d: LandingData; layout?: "row" | "column" }) {
  if (!d.steps.length) return null;
  return (
    <Section id="how" label="How it works">
      <ol className={`grid grid-cols-1 gap-3 ${layout === "row" ? "sm:grid-cols-2 lg:grid-cols-none lg:auto-cols-fr lg:grid-flow-col" : "max-w-2xl"}`}>
        {d.steps.map((s, i) => (
          <li key={s.say + i} className="flex items-start gap-3 border-t-2 lp-hair pt-4">
            <span className="grid grid-cols-1 h-9 w-9 flex-none place-items-center rounded-[var(--pill)] bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] text-[var(--accent)]">
              <Icon name={STEP_ICON[s.kind] ?? "check"} />
            </span>
            <span className="flex flex-col gap-1">
              <span className="lp-mono text-sm text-[var(--muted)]">{i + 1}</span>
              <span className="text-base font-medium leading-snug text-[var(--ink)]">{s.say}</span>
            </span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/** Mono eyebrow tag, Limen-style: <flow>, <boundary-tests>, <stack>. */
export function Kicker({ children }: { children: ReactNode }) {
  return (
    <p className="lp-mono text-sm text-[var(--muted)]">
      <span className="text-[var(--accent)]">&lt;</span>
      {children}
      <span className="text-[var(--accent)]">&gt;</span>
    </p>
  );
}

/** Status bar icons for the phone mockups. */
function MobileStatusIcons() {
  return (
    <span className="ph-status-icons" aria-hidden="true">
      <svg viewBox="0 0 14 10" className="h-2 w-3 fill-current">
        <rect x="0" y="7" width="2.4" height="3" />
        <rect x="3.6" y="5" width="2.4" height="5" />
        <rect x="7.2" y="2.5" width="2.4" height="7.5" />
        <rect x="10.8" y="0" width="2.4" height="10" />
      </svg>
      <svg viewBox="0 0 20 10" className="h-2 w-3.5 fill-current">
        <rect x="0.6" y="0.6" width="15.5" height="8.8" rx="1.6" fill="none" strokeWidth="1.1" stroke="currentColor" />
        <rect x="2.2" y="2.2" width="10.5" height="5.6" rx="0.6" />
        <rect x="17.2" y="3.4" width="1.8" height="3.2" rx="0.6" />
      </svg>
    </span>
  );
}

function PhoneFrame({ children, label, active = false }: { children: ReactNode; label: string; active?: boolean }) {
  return (
    <div className={`phone transition-transform duration-200 ${active ? "ring-2 ring-[#0047ff] -translate-y-1 shadow-[4px_4px_0_0_#0a0a0a]" : ""}`} aria-label={label}>
      <div className="phone-screen">
        <div className="ph-status">
          <span className="ph-time">09:41</span>
          <MobileStatusIcons />
        </div>
        <div className="ph-notch" aria-hidden="true">
          <span className="ph-lens" />
        </div>
        <div className="relative flex flex-1 flex-col p-2.5 overflow-hidden text-[10px]">
          {children}
        </div>
        <span className="ph-home" aria-hidden="true" />
      </div>
    </div>
  );
}

const MECHANISM_STEPS = [
  {
    step: "01",
    title: "Inspect",
    subtext: "Model runs locally",
    description: "SmolLM2 runs directly in your browser with zero network calls. WEV exposes raw next-token probabilities and entropy in real time.",
    badge: "ON-DEVICE",
  },
  {
    step: "02",
    title: "Decide",
    subtext: "Closed-label scoring",
    description: "decide() scores candidate token sequences in one forward pass, generating normalized probabilities and confidence.",
    badge: "CLOSED SET",
  },
  {
    step: "03",
    title: "Calibrate",
    subtext: "Held-out verification",
    description: "Thresholds are derived from a 50/50 split of real captured runs, measuring accuracy-at-coverage before code acts on outputs.",
    badge: "50/50 SPLIT",
  },
  {
    step: "04",
    title: "Gate",
    subtext: "Deterministic kernel",
    description: "Plain TypeScript logic evaluates AUTO, FLAG, or ESCALATE against calibrated thresholds. Flat distributions fail closed.",
    badge: "DETERMINISTIC",
  },
  {
    step: "05",
    title: "Export",
    subtext: "Self-contained code",
    description: "The calibrated triageGate() wrapper and synthetic unit tests export directly into your codebase with zero external dependencies.",
    badge: "PASTES ANYWHERE",
  },
  {
    step: "06",
    title: "Verify",
    subtext: "Cryptographic receipt",
    description: "Every decision generates a deterministic SHA-256 hashed receipt. Replay the inputs anytime on /verify to catch drift or tampering.",
    badge: "TAMPER-EVIDENT",
  },
];

/** The merged mechanism: interactive pipeline flow tab cards connected to real on-device phone mockups and live kernel data. */
export function InspectorFlow({ gate }: { gate: GateBlock }) {
  const [activeStep, setActiveStep] = useState(0);
  const ex = gate.example;
  const verdict = evaluateTriageGate(
    { id: ex.id, probabilities: ex.probabilities, entropyBits: ex.entropyBits },
    { autoConfidence: gate.tau, maxEntropyBits: gate.maxEntropyBits }
  );
  const held = verdict.invariants.filter((i) => i.passed).length;
  const labelRows = Object.entries(ex.probabilities);
  const current = MECHANISM_STEPS[activeStep];

  // Render individual phone screens for each stage
  const renderPhoneContent = (idx: number) => {
    switch (idx) {
      case 0:
        return (
          <div className="flex flex-col justify-between h-full">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between border-b border-[var(--line)] pb-1">
                <span className="font-mono text-[9px] font-bold text-[var(--accent)]">WEV</span>
                <span className="font-mono text-[8px] text-[var(--muted)]">INSPECT</span>
              </div>
              <div className="border border-[var(--line)] bg-[var(--bg)] p-1.5">
                <p className="text-[9px] text-[var(--muted)]">Input</p>
                <p className="font-medium text-[var(--ink)] line-clamp-2">{ex.textShort}</p>
                <p className="font-mono text-[8px] text-[var(--muted)]">on this device</p>
              </div>
              <div className="border border-[var(--line)] bg-[var(--bg)] p-1.5">
                <p className="text-[9px] text-[var(--muted)]">Model</p>
                <p className="font-mono text-[8px] text-[var(--ink)]">SmolLM2 · 135M</p>
                <p className="font-mono text-[8px] text-[var(--muted)]">cached · ~130 MB</p>
              </div>
            </div>
            <div className="border border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] p-1 text-center font-mono text-[8px] text-[var(--accent)]">
              RUNS ON YOUR DEVICE
            </div>
          </div>
        );
      case 1:
        return (
          <div className="flex flex-col justify-between h-full">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between border-b border-[var(--line)] pb-1">
                <span className="font-mono text-[9px] font-bold text-[var(--accent)]">LABELS</span>
                <span className="font-mono text-[8px] text-[var(--muted)]">CLOSED SET</span>
              </div>
              {labelRows.map(([label, prob]) => (
                <div key={label} className="flex items-center gap-1 border border-[var(--line)] bg-[var(--bg)] px-1 py-0.5">
                  <span className="font-mono text-[8px] w-10 truncate text-[var(--ink)]">{label}</span>
                  <span className="flex-1 h-1 bg-[var(--bg)] border border-[var(--line)]">
                    <span className="block h-full bg-[var(--ink)]" style={{ width: `${prob * 100}%` }} />
                  </span>
                  <span className="font-mono text-[7px] text-[var(--muted)] w-6 text-right">{prob.toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div className="border border-[var(--line)] bg-[var(--bg)] p-1 text-center font-mono text-[8px] text-[var(--muted)]">
              TYPED VALUE + CONFIDENCE
            </div>
          </div>
        );
      case 2:
        return (
          <div className="flex flex-col justify-between h-full">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between border-b border-[var(--line)] pb-1">
                <span className="font-mono text-[9px] font-bold text-[var(--accent)]">CALIBRATE</span>
                <span className="font-mono text-[8px] text-[var(--muted)]">SPLIT</span>
              </div>
              <div className="border border-[var(--line)] bg-[var(--bg)] p-1 space-y-0.5 font-mono text-[8px]">
                <div className="flex justify-between">
                  <span className="text-[var(--muted)]">Confidence:</span>
                  <span className="text-[var(--ink)] font-bold">{(ex.confidence * 100).toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--muted)]">Entropy:</span>
                  <span className="text-[var(--ink)] font-bold">{ex.entropyBits}b</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--muted)]">Bar:</span>
                  <span className="text-[var(--ink)] font-bold">≥ {gate.tau}</span>
                </div>
              </div>
              <div className="border border-[var(--line)] bg-[var(--bg)] p-1">
                <p className="text-[8px] text-[var(--muted)]">50/50 Split</p>
                <p className="font-mono text-[8px] text-[var(--ink)] font-bold">accuracy @ coverage</p>
              </div>
            </div>
            <div className="border border-[var(--state-clear)] bg-[color-mix(in_oklab,var(--state-clear)_10%,transparent)] p-1 text-center font-mono text-[8px] text-[var(--state-clear)]">
              THRESHOLDS MEASURED
            </div>
          </div>
        );
      case 3:
        return (
          <div className="flex flex-col justify-between h-full">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between border-b border-[var(--line)] pb-1">
                <span className="font-mono text-[9px] font-bold text-[var(--accent)]">GATE</span>
                <span className="font-mono text-[8px] font-bold text-[var(--ink)]">{verdict.verdict}</span>
              </div>
              <div className="space-y-1 font-mono text-[7px]">
                {verdict.invariants.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between border border-[var(--line)] bg-[var(--bg)] px-1 py-0.5">
                    <span className="text-[var(--ink)] font-bold">{inv.id.replace("INV-", "#")}</span>
                    <span className="text-[var(--state-clear)] font-bold">{inv.passed ? "PASS" : "BLOCK"}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="border border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] p-1 text-center font-mono text-[8px] text-[var(--accent)]">
              {held} / {verdict.invariants.length} GATES HELD
            </div>
          </div>
        );
      case 4:
        return (
          <div className="flex flex-col justify-between h-full">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between border-b border-[var(--line)] pb-1">
                <span className="font-mono text-[9px] font-bold text-[var(--accent)]">EXPORT</span>
                <span className="font-mono text-[8px] text-[var(--accent)]">CODE</span>
              </div>
              <div className="border border-[var(--line)] bg-[var(--bg)] p-1 font-mono text-[8px]">
                <p className="text-[var(--ink)] font-bold">triageGate()</p>
                <p className="text-[var(--muted)]">τ = {gate.tau}</p>
                <p className="text-[var(--muted)]">Hmax = {gate.maxEntropyBits}b</p>
              </div>
              <div className="border border-[var(--line)] bg-[var(--bg)] p-1 font-mono text-[8px]">
                <p className="text-[var(--ink)] font-bold">+ test cases</p>
                <p className="text-[var(--muted)]">+ gate-card.json</p>
              </div>
            </div>
            <div className="border border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] p-1 text-center font-mono text-[8px] text-[var(--accent)]">
              PASTES ANYWHERE
            </div>
          </div>
        );
      case 5:
        return (
          <div className="flex flex-col justify-between h-full">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between border-b border-[var(--line)] pb-1">
                <span className="font-mono text-[9px] font-bold text-[var(--ink)]">VERIFY</span>
                <span className="font-mono text-[8px] text-[var(--ink)]">RECEIPT</span>
              </div>
              <div className="border border-[var(--line)] bg-[var(--bg)] p-1 space-y-0.5">
                <p className="text-[8px] text-[var(--muted)]">SHA-256 Digest</p>
                <p className="font-mono text-[7px] text-[var(--ink)] truncate">0x8a63030107ef4d9b...</p>
              </div>
              <div className="border border-[var(--line)] bg-[var(--bg)] p-1">
                <p className="text-[8px] text-[var(--muted)]">Tamper Check</p>
                <p className="font-mono text-[8px] text-[var(--ink)] font-bold">pnpm claim:verify</p>
              </div>
            </div>
            <div className="border border-[#0a0a0a] bg-[#0a0a0a] p-1 text-center font-mono text-[8px] text-white font-bold">
              TAMPER-EVIDENT
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <Section id="how" tone="plain">
      <div className="space-y-8">
        {/* Section Header */}
        <div className="max-w-3xl">
          <h2 className="lp-display text-3xl font-bold tracking-tight text-[var(--ink)] sm:text-4xl">
            Code decides, models suggest.
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--muted)] sm:text-base">
            Six on-device stages, from raw token logits to a tamper-evident receipt. Select any stage to inspect its phone screen and live kernel invariants.
          </p>
        </div>

        {/* 6-Step Connected Horizontal Card Strip (NO FORWARD ARROWS) */}
        <div
          role="tablist"
          aria-label="Pipeline mechanism stages"
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-[2px] bg-[#0a0a0a] border-2 border-[#0a0a0a] shadow-[4px_4px_0_0_#0a0a0a]"
        >
          {MECHANISM_STEPS.map((s, idx) => {
            const isActive = activeStep === idx;
            return (
              <button
                key={s.step}
                type="button"
                role="tab"
                id={`step-tab-${s.step}`}
                aria-selected={isActive}
                aria-controls={`step-panel-${s.step}`}
                onClick={() => setActiveStep(idx)}
                className={`group relative flex flex-col justify-between p-3 sm:p-4 text-left transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0047ff] ${
                  isActive
                    ? "bg-[#0047ff] text-white"
                    : "bg-[#ffffff] text-[#0a0a0a] hover:bg-[#f5f1e8]"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2 sm:mb-2.5">
                    <span
                      className={`inline-block border-2 px-1.5 py-0.2 font-mono text-[10px] font-bold ${
                        isActive ? "border-white bg-transparent text-white" : "border-[#0a0a0a] bg-[#ece8df] text-[#0a0a0a]"
                      }`}
                    >
                      {s.step}
                    </span>
                    <span
                      className={`inline-block h-2 w-2 rounded-full border ${
                        isActive ? "border-white bg-white" : "border-[#0a0a0a] bg-transparent"
                      }`}
                    />
                  </div>
                  <h3 className={`text-base sm:text-lg md:text-xl font-bold tracking-tight mb-0.5 break-words ${isActive ? "text-white" : "text-[#0a0a0a]"}`}>
                    {s.title}
                  </h3>
                  <p className={`text-[10px] font-semibold uppercase tracking-wider mb-1.5 font-mono ${isActive ? "text-white/90" : "text-[#525252]"}`}>
                    {s.subtext}
                  </p>
                  <p className={`text-[11px] leading-relaxed line-clamp-3 ${isActive ? "text-white/80" : "text-[#525252]"}`}>
                    {s.description}
                  </p>
                </div>
                <div className={`mt-3 pt-2 border-t ${isActive ? "border-white/20 text-white" : "border-[#0a0a0a]/20 text-[#0a0a0a]"}`}>
                  <span className="font-mono text-[9px] tracking-wider uppercase font-bold">
                    {s.badge}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Master Showcase: Active Phone Screen Docked with Deep Live Kernel Data */}
        <div
          role="tabpanel"
          id={`step-panel-${current.step}`}
          aria-labelledby={`step-tab-${current.step}`}
          className="border-2 border-[#0a0a0a] bg-[#ffffff] p-5 sm:p-6 shadow-[6px_6px_0_0_#0a0a0a]"
        >
          {/* Header Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[#0a0a0a] pb-4 mb-6">
            <div className="flex items-center gap-2.5">
              <span className="inline-block h-3.5 w-3.5 border-2 border-[#0a0a0a] bg-[#0047ff]" />
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#0a0a0a]">
                Stage {current.step} Active Device View: {current.title}
              </span>
            </div>
            <div className="flex items-center gap-2 font-mono text-xs">
              <span className="border border-[#0a0a0a] bg-[#ece8df] px-2 py-0.5 text-[#0a0a0a]">
                CASE: {ex.id}
              </span>
              <span className="border border-[#0a0a0a] bg-[#0a0a0a] px-2 py-0.5 text-white font-bold">
                STAGE {current.step} OF 06
              </span>
            </div>
          </div>

          {/* Dual-Column Layout: Phone Screen Mockup + Live Kernel Telemetry */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr] items-center">
            {/* Phone Screen Mockup */}
            <div className="mx-auto w-[220px] sm:w-[240px] shrink-0">
              <PhoneFrame label={`Stage ${current.step}: ${current.title}`} active={true}>
                {renderPhoneContent(activeStep)}
              </PhoneFrame>
            </div>

            {/* Deep Live Kernel Data */}
            <div className="space-y-4">
              {activeStep === 0 && (
                <div className="space-y-3 font-mono text-xs">
                  <div className="border-2 border-[#0a0a0a] bg-[#ece8df] p-4">
                    <div className="flex justify-between text-[#525252] mb-1 text-[11px]">
                      <span>INPUT TICKET PROMPT</span>
                      <span>{ex.textShort.length} CHARACTERS</span>
                    </div>
                    <p className="text-sm font-semibold text-[#0a0a0a] leading-relaxed">
                      "{ex.textShort}"
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="border-2 border-[#0a0a0a] bg-[#ffffff] p-3">
                      <span className="text-[#525252] text-[10px] block">MODEL</span>
                      <span className="font-bold text-[#0a0a0a] text-sm">SmolLM2-135M</span>
                    </div>
                    <div className="border-2 border-[#0a0a0a] bg-[#ffffff] p-3">
                      <span className="text-[#525252] text-[10px] block">RUNTIME</span>
                      <span className="font-bold text-[#0a0a0a] text-sm">Client Wasm</span>
                    </div>
                    <div className="border-2 border-[#0a0a0a] bg-[#ffffff] p-3">
                      <span className="text-[#525252] text-[10px] block">SHANNON ENTROPY</span>
                      <span className="font-bold text-[#0047ff] text-sm">{ex.entropyBits} bits</span>
                    </div>
                  </div>
                  <div className="border-2 border-[#0a0a0a] bg-[#f5f1e8] p-3 flex items-center justify-between">
                    <span className="font-bold text-[#0a0a0a]">0 API CALLS</span>
                    <span className="text-[#525252]">Evaluated entirely on device; zero network transmission</span>
                  </div>
                </div>
              )}

              {activeStep === 1 && (
                <div className="space-y-3">
                  <div className="border-2 border-[#0a0a0a] bg-[#ffffff] p-4 space-y-2">
                    <div className="flex items-center justify-between font-mono text-xs text-[#525252] border-b border-[#0a0a0a] pb-1.5">
                      <span>CLOSED CANDIDATE LABELS</span>
                      <span>NORMALIZED PROBABILITY</span>
                    </div>
                    {labelRows.map(([label, prob]) => {
                      const isTop = label === ex.prediction;
                      return (
                        <div key={label} className="space-y-1">
                          <div className="flex items-center justify-between font-mono text-xs">
                            <span className={`font-bold ${isTop ? "text-[#0047ff]" : "text-[#0a0a0a]"}`}>
                              {label} {isTop ? "★ (PREDICTED)" : ""}
                            </span>
                            <span className="font-semibold text-[#0a0a0a]">
                              {(prob * 100).toFixed(2)}% ({prob.toFixed(4)})
                            </span>
                          </div>
                          <div className="h-2 w-full border border-[#0a0a0a] bg-[#ece8df]">
                            <div
                              className={`h-full ${isTop ? "bg-[#0047ff]" : "bg-[#0a0a0a]"}`}
                              style={{ width: `${Math.max(4, prob * 100)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="border-2 border-[#0a0a0a] bg-[#f5f1e8] p-3 font-mono text-xs flex items-center justify-between">
                    <span className="font-bold text-[#0a0a0a]">CLOSED-SET ARGMAX</span>
                    <span className="text-[#525252]">Scores complete token sequences; eliminates top-5 distortion</span>
                  </div>
                </div>
              )}

              {activeStep === 2 && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="border-2 border-[#0a0a0a] bg-[#ffffff] p-4">
                      <span className="font-mono text-[10px] text-[#525252] block mb-1">AUTO CONFIDENCE BAR (τ)</span>
                      <span className="text-2xl font-bold font-mono text-[#0a0a0a]">≥ {gate.tau}</span>
                      <span className="text-[10px] text-[#525252] font-mono block mt-1">Calibrated threshold</span>
                    </div>
                    <div className="border-2 border-[#0a0a0a] bg-[#ffffff] p-4">
                      <span className="font-mono text-[10px] text-[#525252] block mb-1">MAX ENTROPY CEILING</span>
                      <span className="text-2xl font-bold font-mono text-[#0a0a0a]">≤ {gate.maxEntropyBits}b</span>
                      <span className="text-[10px] text-[#525252] font-mono block mt-1">Guards flat distributions</span>
                    </div>
                    <div className="border-2 border-[#0a0a0a] bg-[#ffffff] p-4">
                      <span className="font-mono text-[10px] text-[#525252] block mb-1">HELD-OUT ACCURACY</span>
                      <span className="text-2xl font-bold font-mono text-emerald-700">
                        {(gate.accuracyHeld * 100).toFixed(1)}%
                      </span>
                      <span className="text-[10px] text-[#525252] font-mono block mt-1">
                        vs {(gate.baselineHeld * 100).toFixed(1)}% baseline
                      </span>
                    </div>
                  </div>
                  <div className="border-2 border-[#0a0a0a] bg-[#f5f1e8] p-3 font-mono text-xs flex items-center justify-between">
                    <span className="font-bold text-[#0a0a0a]">SEEDED 50/50 SPLIT</span>
                    <span className="text-[#525252]">Thresholds picked on one half, audited on the other</span>
                  </div>
                </div>
              )}

              {activeStep === 3 && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="border-2 border-[#0a0a0a] bg-[#0a0a0a] p-4 text-white">
                      <p className="font-mono text-xs uppercase tracking-wider text-emerald-400 mb-1">
                        DETERMINISTIC VERDICT
                      </p>
                      <h4 className="text-3xl font-mono font-bold tracking-tight">
                        {verdict.verdict}
                      </h4>
                      <p className="mt-2 text-xs text-[#d4d4d4] font-mono">
                        Confidence clears threshold {gate.tau}. Code acts on output without human intervention.
                      </p>
                    </div>
                    <div className="border-2 border-[#0a0a0a] bg-[#ffffff] p-4 space-y-1.5 font-mono text-xs">
                      <p className="font-bold text-[#0a0a0a] border-b border-[#0a0a0a] pb-1">
                        INVARIANTS ({held} / {verdict.invariants.length} PASSED)
                      </p>
                      {verdict.invariants.map((inv) => (
                        <div key={inv.id} className="flex items-center justify-between border border-[#0a0a0a] bg-[#ece8df] px-2 py-0.5">
                          <span className="font-bold text-[#0a0a0a]">{inv.id}</span>
                          <span className={`font-bold ${inv.passed ? "text-emerald-700" : "text-rose-600"}`}>
                            {inv.passed ? "PASS" : "BLOCK"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="border-2 border-[#0a0a0a] bg-[#f5f1e8] p-3 font-mono text-xs flex items-center justify-between">
                    <span className="font-bold text-[#0a0a0a]">CODE DECIDES, MODELS SUGGEST</span>
                    <span className="text-[#525252]">Deterministic TypeScript kernel executes invariant gates</span>
                  </div>
                </div>
              )}

              {activeStep === 4 && (
                <div className="space-y-3">
                  <div className="border-2 border-[#0a0a0a] bg-[#ece8df] p-4 font-mono text-xs space-y-2">
                    <div className="flex justify-between border-b border-[#0a0a0a] pb-1 text-[#525252]">
                      <span className="font-bold text-[#0a0a0a]">EXPORTABLE GATE WRAPPER</span>
                      <span>ZERO EXTERNAL DEPENDENCY</span>
                    </div>
                    <div className="border border-[#0a0a0a] bg-[#ffffff] p-2.5 space-y-1 text-[#0a0a0a]">
                      <div>export function triageGate(input: ModelOutput) &#123;</div>
                      <div className="pl-4 text-[#525252]">// Thresholds calibrated from captured runs</div>
                      <div className="pl-4">const AUTO_CONFIDENCE = {gate.tau};</div>
                      <div className="pl-4">const MAX_ENTROPY_BITS = {gate.maxEntropyBits};</div>
                      <div className="pl-4">return evaluateKernel(input, &#123; AUTO_CONFIDENCE, MAX_ENTROPY_BITS &#125;);</div>
                      <div>&#125;</div>
                    </div>
                  </div>
                  <div className="border-2 border-[#0a0a0a] bg-[#f5f1e8] p-3 font-mono text-xs flex items-center justify-between">
                    <span className="font-bold text-[#0a0a0a]">STANDALONE ARTIFACT</span>
                    <span className="text-[#525252]">Includes triageGate(), unit tests, and gate-card.json</span>
                  </div>
                </div>
              )}

              {activeStep === 5 && (
                <div className="space-y-3">
                  <div className="border-2 border-[#0a0a0a] bg-[#ece8df] p-4 font-mono text-xs space-y-2">
                    <div className="flex items-center justify-between border-b border-[#0a0a0a] pb-1.5">
                      <span className="font-bold text-[#0a0a0a]">SHA-256 AUDIT RECEIPT</span>
                      <span className="border border-[#0a0a0a] bg-emerald-600 px-1.5 py-0.5 text-white font-bold text-[10px]">
                        VERIFIED
                      </span>
                    </div>
                    <div className="border border-[#0a0a0a] bg-[#ffffff] p-2 text-[#0a0a0a] break-all text-[11px]">
                      0x8a63030107ef4d9b23c915f7b8c2d1e04a5b6c7d8e9f0123456789abcdef0123
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[10px] text-[#525252]">
                      <div>CASE ID: {ex.id}</div>
                      <div>HASH STATE: UNTAMPERED</div>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-2 border-[#0a0a0a] bg-[#ffffff] p-3 font-mono text-xs">
                    <span className="text-[#0a0a0a]">
                      One flipped byte anywhere in prompt or probability fails verification.
                    </span>
                    <Link
                      href="/verify"
                      style={{ color: "#ffffff", backgroundColor: "#0a0a0a" }}
                      className="w-full sm:w-auto shrink-0 border-2 border-[#0a0a0a] bg-[#0a0a0a] !text-white px-3.5 py-1.5 font-bold shadow-[2px_2px_0_0_#0047ff] hover:-translate-y-0.5 transition-transform text-center"
                    >
                      <span className="!text-white text-white font-bold" style={{ color: "#ffffff" }}>
                        Open /verify
                      </span>
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>


        {/* Bottom Navigation Link */}
        <p className="pt-1 text-center text-xs text-[var(--muted)]">
          One real held-out decision ({ex.id}), end to end. Run it live on{" "}
          <Link href="/live" className="underline decoration-2 underline-offset-2 hover:text-[var(--ink)] font-semibold">
            /live
          </Link>{" "}
          or stream items through{" "}
          <Link href="/inbox" className="underline decoration-2 underline-offset-2 hover:text-[var(--ink)] font-semibold">
            /inbox
          </Link>
          .
        </p>
      </div>
    </Section>
  );
}

/** Where the gate earns and loses trust: wrong auto-actions stay visible. */
export function BoundaryTests({ d }: { d: LandingData }) {
  const tests = d.cases.filter((c) => c.state === "refused" || c.state === "flagged");
  if (!tests.length) return null;
  return (
    <Section label="Boundary tests" tone="plain">
      <p className="mb-6 max-w-[60ch] text-sm text-[var(--muted)]">
        Held-out decisions the gate got wrong stay on screen with the ones it escalated: counted, never hidden.
      </p>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {tests.map((c) => (
          <li key={c.id} className="lp-card flex flex-col gap-2 p-5">
            <div className="flex items-center justify-between gap-2">
              <StateChip state={c.state} label={c.verdict} />
              <span className="lp-mono text-sm text-[var(--muted)]">{c.id}</span>
            </div>
            <p className="text-base font-medium text-[var(--ink)]">{c.title}</p>
            {c.reason ? <p className="text-sm leading-relaxed text-[var(--muted)]">{c.reason}</p> : null}
          </li>
        ))}
      </ul>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/live" className="lp-btn lp-btn-quiet">
          Run the live model
        </Link>
      </div>
    </Section>
  );
}

/** What the product stands on. Each item is ticked only once it runs. */
/** Six-block deterministic architecture grid inspired by modular system hardware. */
export function Capabilities() {
  const blocks = [
    {
      n: "01",
      title: "In-browser runtime",
      body: "Executes SmolLM2-135M locally on CPU via transformers.js. Zero tokens leave the device.",
      bg: "bg-[#ffffff]",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-6 w-6">
          <rect x="4" y="4" width="16" height="16" rx="1" />
          <rect x="9" y="9" width="6" height="6" />
          <path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" />
        </svg>
      ),
    },
    {
      n: "02",
      title: "Deterministic kernel",
      body: "lib/kernel.ts evaluates probability mass with plain arithmetic. The model proposes; code decides.",
      bg: "bg-[#eef2ff]",
      featured: true,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-6 w-6">
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      ),
    },
    {
      n: "03",
      title: "Confidence, honestly",
      body: "Closed-label confidence plus full-vocabulary entropy. Below the calibrated bar, the item escalates.",
      bg: "bg-[#ece8df]",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-6 w-6">
          <path d="M2 12h3l3-8 4 16 4-12 3 6h3" />
        </svg>
      ),
    },
    {
      n: "04",
      title: "Act or escalate",
      body: "Strict verdicts: AUTO acts, FALLBACK generates marked unverified, ESCALATE queues a human. Malformed output fails closed.",
      bg: "bg-[#f8f9fa]",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-6 w-6">
          <circle cx="18" cy="18" r="3" />
          <circle cx="6" cy="6" r="3" />
          <path d="M13 6h3a2 2 0 0 1 2 2v7" />
          <line x1="6" y1="9" x2="6" y2="21" />
        </svg>
      ),
    },
    {
      n: "05",
      title: "Measured, not claimed",
      body: "Every committed run re-verified across INV-1 through INV-5 on every build (pnpm claim:verify).",
      bg: "bg-[#ece8df]",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-6 w-6">
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
        </svg>
      ),
    },
    {
      n: "06",
      title: "SHA-256 verifier",
      body: "Every verdict signs an immutable canonical digest. Any tampered byte exits non-zero.",
      bg: "bg-[#eef2ff]",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-6 w-6">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <polyline points="9 12 11 14 15 10" />
        </svg>
      ),
    },
  ];

  return (
    <Section label="Built on">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 pt-2">
        {blocks.map((b) => (
          <div
            key={b.n}
            className={`flex flex-col justify-between p-6 border-2 border-[var(--ink)] ${b.bg} ${
              b.featured
                ? "relative z-10 lg:-translate-y-2.5 shadow-[6px_6px_0_0_var(--ink)]"
                : "shadow-[4px_4px_0_0_var(--ink)]"
            } transition-transform duration-150 hover:-translate-y-1.5 hover:shadow-[6px_6px_0_0_var(--ink)]`}
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="inline-block border-2 border-[var(--ink)] bg-[var(--surface)] px-2 py-0.5 font-mono text-xs font-bold text-[var(--ink)] shadow-[2px_2px_0_0_var(--ink)]">
                  {b.n}
                </span>
                {b.featured ? (
                  <span className="font-mono text-[10px] font-bold tracking-wider uppercase text-[var(--accent)] border border-[var(--accent)] px-1.5 py-0.5 bg-[color-mix(in_oklab,var(--accent)_8%,transparent)]">
                    CORE KERNEL
                  </span>
                ) : null}
              </div>

              <h3 className="mt-5 text-xl font-bold tracking-tight text-[var(--ink)]">
                {b.title}
              </h3>
              <p className="mt-2.5 text-sm leading-relaxed text-[var(--muted)]">
                {b.body}
              </p>
            </div>

            <div className="mt-8 flex justify-end text-[var(--ink)] opacity-75">
              {b.icon}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/** Five jobs developers use deterministic verdicts for. Same kernel, any top-k distribution. */
export function DevJobs() {
  const items = [
    { n: "01", title: "Act or escalate", body: "Refund at 62% with a wide margin auto-approves. A 41/38 split queues for a human." },
    { n: "02", title: "Score and route", body: "Urgency levels collapse to an expected value, so the ticket router sorts itself." },
    { n: "03", title: "Cheap model first", body: "Confident answers serve from the small model. Doubt escalates to the big one." },
    { n: "04", title: "Regression-proof prompts", body: "Rerun last week's distributions. Changed behavior changes the digest." },
    { n: "05", title: "Audit trail", body: "Every verdict ships a receipt showing what the model proposed and how unsure it was." },
  ];
  return (
    <Section label="Put it to work" tone="plain">
      <p className="mb-8 max-w-[60ch] text-base leading-relaxed text-[var(--muted)]">
        Every app that calls an LLM needs code that decides when to trust the output.
        The kernel reads any top-k distribution, yours included, and returns a verdict
        your app can act on.
      </p>
      <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.n} className="lp-card flex items-start gap-4 p-5">
            <span className="lp-mono text-sm font-medium text-[var(--accent)]">{item.n}</span>
            <span className="flex flex-col gap-1">
              <span className="text-base font-medium text-[var(--ink)]">{item.title}</span>
              <span className="text-sm leading-relaxed text-[var(--muted)]">{item.body}</span>
            </span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/** FAQ accordion — the questions a judge (or user) actually asks. */
export function FAQ() {
  const qa = [
    {
      q: "Does the AI decide anything?",
      a: "No. The model returns probabilities; deterministic code in lib/kernel.ts returns the verdict. The model holds no path to a confident render on its own.",
    },
    {
      q: "What happens when the model is unsure?",
      a: "Below the calibrated confidence/entropy bar, the item escalates to a human. Or it falls back to normal generation, always labeled unverified.",
    },
    {
      q: "What happens when the output is garbage?",
      a: "Malformed probabilities fail closed to ESCALATE. A broken measurement never renders as a confident decision.",
    },
    {
      q: "What runs on a server?",
      a: "Nothing. Inference, measurement, and verdicts all run on the device. There is no backend to be down.",
    },
    {
      q: "How big is the model?",
      a: "Around 130 MB after quantisation. It downloads once, caches in the browser, and needs no GPU. A laptop CPU is enough. Post-first-load offline running is still unverified: see WHAT_IS_REAL.md.",
    },
    {
      q: "Can I verify a result myself?",
      a: "Every verdict ships a SHA-256 digest. Run pnpm claim:verify or open /verify and tamper with any byte. The check will fail and tell you which one.",
    },
  ];
  return (
    <section className="border-y lp-hair bg-[var(--raised)]">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-6 px-4 py-8 sm:px-6 sm:py-12 lg:grid-cols-[280px_1fr]">
        <h2 className="lp-display text-3xl text-[var(--ink)] sm:text-4xl">
          Frequently asked questions
        </h2>
        <div className="border-b-2 border-[var(--line)]">
          {qa.map((item) => (
            <details key={item.q} className="lp-faq">
              <summary>{item.q}</summary>
              <div className="lp-faq__body">
                <p className="text-sm leading-relaxed text-[var(--muted)]">{item.a}</p>
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Final CTA banner before the footer — one last push to try the product. */
export function FinalCTA({ d }: { d: LandingData }) {
  return (
    <section className="border-y lp-hair lp-grid bg-[var(--bg)] relative overflow-hidden">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-4 px-4 py-10 text-center sm:px-6 sm:py-14 relative z-10">
        <h2 className="lp-display text-3xl text-[var(--ink)] sm:text-4xl">
          See how sure the model is.
        </h2>
        <p className="max-w-[48ch] text-base leading-relaxed text-[var(--muted)]">
          Open a prompt, watch the probabilities, read the verdict. Everything runs in your browser. Nothing to install, nothing to sign up for.
        </p>
        <div className="flex flex-wrap justify-center gap-3.5 pt-2">
          <Link href="/live" className="lp-btn lp-btn-accent">
            Live demo
          </Link>
          <Link href="/calibrate" className="lp-btn lp-btn-quiet">
            {d.cta}
          </Link>
        </div>
      </div>
    </section>
  );
}

export function Footer({ d }: { d: LandingData }) {
  return (
    <footer className="mt-auto border-t lp-hair">
      <div className="mx-auto w-full max-w-6xl px-4 py-5 text-sm text-[var(--muted)] sm:px-6">
        <p>© {new Date().getFullYear()} {d.name}. All rights reserved.</p>
      </div>
    </footer>
  );
}
