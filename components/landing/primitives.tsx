// components/landing/primitives.tsx — small pieces shared by the landing sections and the
// sample desk. No visible sentence lives here: every word on screen is a short label or
// comes from lib/landing.ts.
import type { DecisionState, Fact, SampleCase, Source } from "@/lib/landing";
import "./landing.css";

export type IconName = "open" | "click" | "fill" | "wait" | "arrow" | "reset" | "play" | "check" | "doc" | "pin" | "shield" | "copy";

const PATHS: Record<IconName, string> = {
  open: "M4 5h16v14H4zM4 9h16",
  click: "M9 3v4M3 9h4M5.5 5.5l2.5 2.5M10 10l10 4-4 2-2 4z",
  fill: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  wait: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  arrow: "M5 12h14M13 6l6 6-6 6",
  reset: "M4 4v6h6M4.6 15a8 8 0 1 0 1.9-8.3L4 10",
  play: "M7 5l12 7-12 7z",
  check: "M5 12.5l4.5 4.5L19 7",
  doc: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  pin: "M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  shield: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
};

export function Icon({ name, className = "h-4 w-4" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

export function StateChip({ state, label }: { state: DecisionState; label: string }) {
  return (
    <span className="lp-state" data-state={state}>
      {label}
    </span>
  );
}

export function SyntheticBadge() {
  return (
    <span className="lp-chip">
      <Icon name="doc" className="h-3.5 w-3.5" />
      Synthetic sample
    </span>
  );
}

export function FactGrid({ facts, size = "md" }: { facts: Fact[]; size?: "md" | "lg" }) {
  if (!facts.length) return null;
  const cols = facts.length === 1 ? "grid-cols-1" : facts.length === 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-2";
  return (
    <dl className={`grid w-full gap-px overflow-hidden rounded-[var(--radius-sm)] border lp-hair bg-[var(--line)] ${cols}`}>
      {facts.map((f) => (
        <div key={f.label + f.value} className="bg-[var(--surface)] px-4 py-3">
          <dt className="text-sm text-[var(--muted)]">{f.label}</dt>
          <dd className={`lp-mono mt-1 font-medium text-[var(--ink)] ${size === "lg" ? "text-xl sm:text-2xl" : "text-base"} break-words`}>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SourceList({ sources, limit = 4 }: { sources: Source[]; limit?: number }) {
  if (!sources.length) return null;
  const shown = sources.slice(0, limit);
  const quotes = shown.filter((s) => s.quote);
  const chips = shown.filter((s) => !s.quote);
  return (
    <div className="flex w-full flex-col gap-3">
      {quotes.map((s) => (
        <figure key={s.label + s.quote} className="lp-quote">
          <blockquote className="lp-mono text-sm leading-relaxed text-[var(--ink)] break-words">{s.quote}</blockquote>
          <figcaption className="mt-1 text-sm text-[var(--muted)]">
            {s.label}
            {s.detail ? <span className="lp-mono"> · {s.detail}</span> : null}
          </figcaption>
        </figure>
      ))}
      {chips.length ? (
        <ul className="flex flex-wrap gap-2">
          {chips.map((s) => (
            <li key={s.label + (s.detail ?? "")}>
              {s.href ? (
                <a href={s.href} target="_blank" rel="noreferrer" className="lp-chip lp-focus hover:text-[var(--ink)]">
                  {s.label}
                  {s.detail ? <span className="lp-mono text-[var(--ink)]">{s.detail}</span> : null}
                </a>
              ) : (
                <span className="lp-chip">
                  {s.label}
                  {s.detail ? <span className="lp-mono text-[var(--ink)]">{s.detail}</span> : null}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function FindingCard({
  c,
  persona,
  headingLevel = "h2",
  size = "lg",
}: {
  c: SampleCase;
  persona?: string;
  headingLevel?: "h2" | "h3";
  size?: "md" | "lg";
}) {
  const Heading = headingLevel;
  return (
    <article className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StateChip state={c.state} label={c.verdict} />
        <span className="lp-mono text-sm text-[var(--muted)]">{c.id}</span>
      </div>
      <div className="flex flex-col gap-2">
        <Heading className={`lp-display text-[var(--ink)] ${size === "lg" ? "text-2xl sm:text-[1.75rem]" : "text-lg"}`}>{c.title}</Heading>
        {c.reason ? <p className="lp-pretty text-sm leading-relaxed text-[var(--muted)]">{c.reason}</p> : null}
      </div>
      <FactGrid facts={c.facts} size={size} />
      <SourceList sources={c.sources} />
      {persona ? (
        <p className="flex items-center gap-2 border-t lp-hair pt-4 text-sm text-[var(--muted)]">
          <SyntheticBadge />
          <span>{persona}</span>
        </p>
      ) : null}
    </article>
  );
}

export function EmptyFinding({ hint }: { hint: string }) {
  return (
    <div className="flex min-h-56 flex-col items-start justify-center gap-3 p-2">
      <StateChip state="pending" label="No sample case yet" />
      <p className="lp-mono text-sm text-[var(--muted)]">{hint}</p>
    </div>
  );
}
