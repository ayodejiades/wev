// lib/landing.ts — everything the landing page shows, read from the project's own data.
//
// The page renders product content, never baked-in prose. Three sources feed it:
//
//   brief.json            name, idea, and two optional blocks:
//     "landing": {
//       "promise":  "Catch late invoices before they cost you",  // H1 line, under 10 words
//       "boundary": "Flags invoices; never pays or emails a vendor.",
//       "persona":  { "name": "Ada", "role": "accounts-payable lead" },
//       "trust":    ["Stored only on this device"],               // only statements that are true
//       "stateLabels": { "clear": "Paid", "flagged": "Past due", "pending": "Needs your answer", "refused": "Can't tell" },
//       "cta": "Upload a CSV"                                       // real-use button label
//     }
//     "design": {
//       "preset": "calm" | "editorial" | "night" | "soft" | "instrument" | "brutal" | "swiss" | "terminal" | "aurora",
//       "accent": "#2F5BEA", "radius": 16,          // accent defaults to brief.json "accent"
//       "tokens": { "bg": "#...", "edge": 2, "shadow": "5px 5px 0 0 #111" },  // any DesignTokens key, overrides the preset
//       "fonts":  { "sans": "Inter", "display": "Inter", "mono": "Geist Mono" }  // written to components/landing/fonts.ts by generate_landing.py
//     }
//   docs/demo-path.json   steps[].say — the click path, shown as the "how it works" rail
//   the fixture file      evidence/campaign-report.json (web2) · PROOF_RUNS.json (web3)
//     cases[] / runs[] of any shape. Add an optional "display" block to a case to say it
//     in the user's words; without one, its fields are read as they are:
//     "display": {
//       "title": "Invoice INV-2291 is 34 days past due",
//       "state": "flagged", "verdict": "Past due",
//       "reason": "Net-30 terms; no paid date in the ledger export.",
//       "facts": [{ "label": "Due", "value": "Aug 25" }, { "label": "Amount", "value": "$4,120.00" }],
//       "sources": [{ "label": "invoices.csv", "detail": "row 14", "quote": "INV-2291,2026-07-26,4120.00" }],
//       "location": { "lat": 6.52, "lng": 3.37, "place": "Ikeja depot" },
//       "featured": true
//     }
//
// No number on the landing is typed into a component: every figure is a fixture value or
// a count of fixture cases.
import briefJson from "@/brief.json";
import demoPathJson from "@/fixtures/demo-path.json";
import fixtureJson from "@/evidence/campaign-report.json";
import calibrationJson from "@/evidence/calibration.json";
import capturedJson from "@/evidence/captured-runs.json";

export const FIXTURE_PATH = "evidence/campaign-report.json";

export type DecisionState = "clear" | "flagged" | "pending" | "refused";
export const DECISION_STATES: DecisionState[] = ["flagged", "pending", "refused", "clear"];

export interface Fact {
  label: string;
  value: string;
}

export interface Source {
  label: string;
  detail?: string;
  quote?: string;
  href?: string;
}

export interface SampleCase {
  id: string;
  title: string;
  state: DecisionState;
  verdict: string;
  reason?: string;
  facts: Fact[];
  sources: Source[];
  location?: { lat?: number; lng?: number; place?: string };
  request?: unknown;
  response?: unknown;
}

export interface DemoStep {
  say: string;
  kind: "open" | "click" | "fill" | "wait";
}

/** Measured gate numbers + one real held-out decision, for the landing copy. */
export interface GateExample {
  id: string;
  textShort: string;
  prediction: string;
  confidence: number;
  entropyBits: number;
  probabilities: Record<string, number>;
}

export interface GateBlock {
  tau: number;
  maxEntropyBits: number;
  modelId: string;
  dtype: string;
  seed: number;
  totalRuns: number;
  calibTotal: number;
  heldTotal: number;
  labelCount: number;
  autoHeld: number;
  escalatedHeld: number;
  wrongHeld: number;
  accuracyHeld: number;
  baselineHeld: number;
  coverageHeld: number;
  example: GateExample;
}

export interface LandingData {
  name: string;
  promise?: string;
  idea: string;
  audience?: string;
  problem?: string;
  boundary?: string;
  persona?: string;
  cta: string;
  trust: string[];
  stateLabels: Record<DecisionState, string>;
  cases: SampleCase[];
  featured?: SampleCase;
  counts: Record<DecisionState, number>;
  steps: DemoStep[];
  gate: GateBlock;
  checkedAt?: string;
  fixturePath: string;
  setupHint: string;
  design: ResolvedDesign;
}

/* ----------------------------------------------------------------- design tokens */

export interface DesignTokens {
  mode: "light" | "dark";
  bg: string;
  surface: string;
  raised: string;
  ink: string;
  muted: string;
  line: string;
  accent: string;
  "state-clear": string;
  "state-flagged": string;
  "state-pending": string;
  "state-refused": string;
  radius: number;
  /** edge width of cards and chips, px */
  edge: number;
  /** edge width drawn around buttons, px (0 = none) */
  "button-edge": number;
  /** card elevation beyond the edge: "soft", "none", or any CSS box-shadow */
  shadow: string;
  /** button elevation: "soft", "none", or any CSS box-shadow */
  "button-shadow": string;
  /** px a button moves on hover (negative lifts up-left, for hard-shadow styles) */
  lift: number;
  /** weight of display headings */
  "display-weight": number;
  /** strength of the accent bloom behind the hero, 0–60 (%) */
  bloom: number;
  /** backdrop blur on cards, px (0 = opaque surfaces) */
  glass: number;
}

export interface ResolvedDesign {
  preset: string;
  mode: "light" | "dark";
  style: Record<string, string>;
}

type Palette = Omit<DesignTokens, "edge" | "button-edge" | "shadow" | "button-shadow" | "lift" | "display-weight" | "bloom" | "glass">;
const SOFT = { edge: 1, "button-edge": 0, shadow: "soft", "button-shadow": "soft", lift: 0, "display-weight": 500, bloom: 16, glass: 0 };
const preset = (palette: Palette, feel: Partial<DesignTokens> = {}): DesignTokens => ({ ...palette, ...SOFT, ...feel });

// Starting points only. The implement step picks one for the product and overrides any
// token in brief.json "design"; none of these is a fixed look.
export const DESIGN_PRESETS: Record<string, DesignTokens> = {
  // cool neutral, lots of air: tools people use at work every day
  calm: preset({
    mode: "light", bg: "#f6f7f9", surface: "#fcfcfd", raised: "#eef0f4", ink: "#0d1117",
    muted: "#5b6472", line: "rgba(13, 17, 23, 0.09)", accent: "#2f5bea",
    "state-clear": "#12805c", "state-flagged": "#c2410c", "state-pending": "#a16207", "state-refused": "#6b7280",
    radius: 18,
  }),
  // warm paper and a serif display: reports, civic and research work
  editorial: preset({
    mode: "light", bg: "#f7f4ee", surface: "#fffdf9", raised: "#efe9dd", ink: "#1b1813",
    muted: "#6e6557", line: "rgba(27, 24, 19, 0.11)", accent: "#9a3412",
    "state-clear": "#166534", "state-flagged": "#b91c1c", "state-pending": "#a16207", "state-refused": "#57534e",
    radius: 12,
  }, { "display-weight": 400, bloom: 8 }),
  // deep ink with a luminous accent: protocols, chains, infrastructure
  night: preset({
    mode: "dark", bg: "#05070d", surface: "#0c111c", raised: "#131a29", ink: "#eef2fb",
    muted: "#8d97ab", line: "rgba(238, 242, 251, 0.10)", accent: "#4da2ff",
    "state-clear": "#34d399", "state-flagged": "#fb923c", "state-pending": "#facc15", "state-refused": "#94a3b8",
    radius: 20,
  }, { bloom: 24 }),
  // soft, rounded, friendly: consumer, health and learning products
  soft: preset({
    mode: "light", bg: "#fbf8f6", surface: "#fffdfc", raised: "#f4eeea", ink: "#1f1a24",
    muted: "#6f6776", line: "rgba(31, 26, 36, 0.09)", accent: "#6d4aff",
    "state-clear": "#15803d", "state-flagged": "#dc2626", "state-pending": "#b45309", "state-refused": "#71717a",
    radius: 24,
  }, { bloom: 20 }),
  // dense and precise: developer tools, data and evaluation consoles
  instrument: preset({
    mode: "light", bg: "#f5f5f4", surface: "#fdfdfc", raised: "#ededeb", ink: "#111110",
    muted: "#62625e", line: "rgba(17, 17, 16, 0.10)", accent: "#0f766e",
    "state-clear": "#15803d", "state-flagged": "#c2410c", "state-pending": "#a16207", "state-refused": "#6b7280",
    radius: 12,
  }, { bloom: 10 }),
  // neobrutalist: flat warm paper, 2px ink edges, hard offset shadows, loud display type
  brutal: preset({
    mode: "light", bg: "#fff1d6", surface: "#fffaf0", raised: "#ffe3a8", ink: "#121212",
    muted: "#3f3a33", line: "#121212", accent: "#ff5a36",
    "state-clear": "#138a4a", "state-flagged": "#e0203f", "state-pending": "#d98a00", "state-refused": "#57534e",
    radius: 14,
  }, { edge: 2, "button-edge": 2, shadow: "5px 5px 0 0 #121212", "button-shadow": "3px 3px 0 0 #121212", lift: -2, "display-weight": 700, bloom: 0 }),
  // Swiss grid: white, black, one red, square corners, no elevation
  swiss: preset({
    mode: "light", bg: "#f3f3ef", surface: "#fbfbf8", raised: "#e9e9e3", ink: "#0b0b0b",
    muted: "#55554f", line: "rgba(11, 11, 11, 0.16)", accent: "#e3301c",
    "state-clear": "#127a45", "state-flagged": "#e3301c", "state-pending": "#b7791f", "state-refused": "#6b6b66",
    radius: 0,
  }, { shadow: "none", "button-shadow": "none", "display-weight": 600, bloom: 0 }),
  // console green on near-black, tight corners: shells, agents, dev infrastructure
  terminal: preset({
    mode: "dark", bg: "#080a08", surface: "#0e120e", raised: "#141a14", ink: "#dcf5e1",
    muted: "#7d9885", line: "rgba(220, 245, 225, 0.12)", accent: "#3ddc84",
    "state-clear": "#3ddc84", "state-flagged": "#ff8c42", "state-pending": "#f5d547", "state-refused": "#8a9a8f",
    radius: 6,
  }, { shadow: "none", "button-shadow": "none", bloom: 10 }),
  // dark with a vivid bloom and glass panels: AI and consumer launches
  aurora: preset({
    mode: "dark", bg: "#07060e", surface: "rgba(255, 255, 255, 0.045)", raised: "rgba(255, 255, 255, 0.075)", ink: "#f3f1ff",
    muted: "#a09cb8", line: "rgba(243, 241, 255, 0.12)", accent: "#8f7cff",
    "state-clear": "#4ade80", "state-flagged": "#fb7185", "state-pending": "#fbbf24", "state-refused": "#a1a1aa",
    radius: 22,
  }, { bloom: 42, glass: 18 }),
};

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function resolveDesign(input: BriefDesign | undefined, projectAccent: string | undefined): ResolvedDesign {
  const presetName = input?.preset && DESIGN_PRESETS[input.preset] ? input.preset : "calm";
  const base = DESIGN_PRESETS[presetName];
  const tokens: DesignTokens = { ...base, ...(input?.tokens ?? {}) };
  // The project accent (brief.json "accent", set with the theme) keeps the landing and the
  // app in one colour; design.accent overrides it for the landing alone.
  const accent = str(input?.accent) ?? (projectAccent && hexToRgb(projectAccent) ? projectAccent : undefined) ?? tokens.accent;
  const radius = typeof input?.radius === "number" ? input.radius : tokens.radius;
  const shadow = (value: string, soft: string) => (value === "soft" ? soft : value === "none" ? "0 0 #0000" : value);
  const style: Record<string, string> = {
    "--bg": tokens.bg,
    "--surface": tokens.surface,
    "--raised": tokens.raised,
    "--ink": tokens.ink,
    "--muted": tokens.muted,
    "--line": tokens.line,
    "--accent": accent,
    "--accent-ink": luminance(accent) > 0.45 ? "#0b0b0c" : "#fbfcfe",
    "--state-clear": tokens["state-clear"],
    "--state-flagged": tokens["state-flagged"],
    "--state-pending": tokens["state-pending"],
    "--state-refused": tokens["state-refused"],
    "--radius": `${radius}px`,
    "--radius-sm": `${radius === 0 ? 0 : Math.max(6, Math.round(radius * 0.55))}px`,
    "--edge": `${tokens.edge}px`,
    "--button-edge": `${tokens["button-edge"]}px`,
    "--shadow": shadow(
      tokens.shadow,
      "0 1px 2px color-mix(in oklab, var(--ink) 6%, transparent), 0 24px 48px -28px color-mix(in oklab, var(--ink) 30%, transparent)",
    ),
    "--button-shadow": shadow(tokens["button-shadow"], "0 1px 2px color-mix(in oklab, var(--ink) 8%, transparent)"),
    "--lift": `${tokens.lift}px`,
    "--display-weight": String(tokens["display-weight"]),
    "--bloom": `${Math.max(0, Math.min(60, tokens.bloom))}%`,
    "--glass": tokens.glass > 0 ? `blur(${tokens.glass}px) saturate(1.4)` : "none",
    colorScheme: tokens.mode,
  };
  return { preset: presetName, mode: tokens.mode, style };
}

/* ----------------------------------------------------------------- raw shapes */

interface BriefDesign {
  preset?: string;
  accent?: string;
  radius?: number;
  tokens?: Partial<DesignTokens>;
}

interface Brief {
  project?: string;
  name?: string;
  idea?: string;
  accent?: string;
  wedge?: { target_user?: string; painful_moment?: string };
  landing?: {
    name?: string;
    promise?: string;
    usp?: string;
    problem?: string;
    boundary?: string;
    persona?: string | { name?: string; role?: string };
    trust?: string[];
    stateLabels?: Partial<Record<DecisionState, string>>;
    cta?: string;
  };
  design?: BriefDesign;
}

type Raw = Record<string, unknown>;

interface Fixture {
  generatedAt?: string | null;
  explorerUrl?: string;
  summary?: { status?: string };
  cases?: unknown[];
  runs?: unknown[];
}

/* ----------------------------------------------------------------- helpers */

const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

function titleCase(slug: string): string {
  if (slug !== slug.toLowerCase()) return slug;
  return slug.split(/[-_\s]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

function humanize(key: string): string {
  const words = key
    .replace(/(Cents|Usd|Bps|Ms)$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

const HASH_RE = /^0x[0-9a-f]{16,}$/i;
const shortHash = (h: string) => (h.length > 18 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h);

function formatValue(key: string, value: number | string): string {
  if (typeof value === "string") return value;
  if (/cents$/i.test(key)) return `$${(value / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (/usd$/i.test(key)) return `$${value.toLocaleString("en-US")}`;
  if (/bps$/i.test(key)) return `${value.toLocaleString("en-US")} bps`;
  if (/Ms$/.test(key)) return `${value.toLocaleString("en-US")} ms`;
  return value.toLocaleString("en-US");
}

// Keys that say what a case *is* (title, state, ids, evidence) rather than a fact about it.
const NOT_FACTS = new Set([
  "id", "caseId", "title", "name", "description", "category", "status", "state", "kind", "decision",
  "expectedState", "display", "timestamp", "createdAt", "generatedAt", "invariant", "invariantsChecked",
  "sourceCaptureT0", "extractedExcerpt", "txs", "txHash", "digestHash", "reasonHash", "eip712Certificate",
  "reason", "refusalReason", "summary", "sources", "location", "domain", "nonce",
]);

function collectFacts(raw: Raw, out: Fact[], depth = 0): void {
  for (const [key, value] of Object.entries(raw)) {
    if (out.length >= 4) return;
    if (NOT_FACTS.has(key)) continue;
    if (typeof value === "number" && Number.isFinite(value)) {
      out.push({ label: humanize(key), value: formatValue(key, value) });
    } else if (typeof value === "string" && value.length <= 40 && !HASH_RE.test(value)) {
      out.push({ label: humanize(key), value });
    } else if (isObj(value) && depth < 1) {
      collectFacts(value, out, depth + 1);
    }
  }
}

function collectSources(raw: Raw, explorer: string | undefined): Source[] {
  const sources: Source[] = [];
  if (Array.isArray(raw.sources)) {
    for (const s of raw.sources) {
      if (typeof s === "string") sources.push({ label: s });
      else if (isObj(s) && str(s.label)) sources.push(s as unknown as Source);
    }
  }
  const excerpt = str(raw.extractedExcerpt);
  const capture = str(raw.sourceCaptureT0);
  if (excerpt) sources.push({ label: "Quoted", quote: excerpt });
  else if (capture) sources.push({ label: "Source", quote: capture.length > 180 ? `${capture.slice(0, 180)}…` : capture });
  const txs: Raw = isObj(raw.txs) ? raw.txs : str(raw.txHash) ? { tx: raw.txHash } : {};
  for (const [k, v] of Object.entries(txs)) {
    if (typeof v !== "string" || !v) continue;
    sources.push({ label: humanize(k), detail: shortHash(v), href: explorer ? `${explorer.replace(/\/$/, "")}/tx/${v}` : undefined });
  }
  const digest = str(raw.digestHash) ?? (isObj(raw.postState) ? str(raw.postState.digest) : undefined);
  if (digest) sources.push({ label: "Digest", detail: shortHash(digest) });
  const rules = Array.isArray(raw.invariantsChecked) ? raw.invariantsChecked : str(raw.invariant) ? [raw.invariant] : [];
  if (rules.length) sources.push({ label: "Rule", detail: rules.join(" · ") });
  return sources;
}

function classify(rawState: string): DecisionState {
  const s = rawState.toUpperCase();
  if (/WAIT|PENDING|REVIEW|HOLD|AMBIG|UNKNOWN|NEEDS|UNSURE/.test(s) && !/ABSTAIN/.test(s)) return "pending";
  if (/REFUS|BLOCK|ABSTAIN|REJECT|DENY|DENIED|INSUFFICIENT|FAIL|INVALID/.test(s)) return "refused";
  if (/BENIGN|NO_DRIFT|ON_TRACK|NOOP/.test(s)) return "clear";
  if (/DRIFT|DISCREP|FLAG|OVERDUE|LATE|ALERT|MISMATCH|ANOMAL|DETECT|ISOLAT|RISK|WARN|DUE/.test(s)) return "flagged";
  return "clear";
}

function sentenceCase(raw: string): string {
  const t = raw.replace(/[_-]+/g, " ").toLowerCase().trim();
  return t ? t[0].toUpperCase() + t.slice(1) : raw;
}

function normalizeCase(raw: Raw, index: number, labels: Record<DecisionState, string>, explorer?: string): SampleCase {
  const d: Raw = isObj(raw.display) ? raw.display : {};
  const id = str(raw.caseId) ?? str(raw.id) ?? `case-${index + 1}`;
  const rawState = str(raw.expectedState) ?? str(raw.state) ?? str(raw.decision) ?? str(raw.status) ?? str(raw.kind) ?? "";
  const explicit = ["clear", "flagged", "pending", "refused"].includes(String(d.state));
  const state = explicit ? (d.state as DecisionState) : classify(rawState);
  const title = str(d.title) ?? str(raw.title) ?? str(raw.name) ?? str(raw.description) ?? id;
  const facts: Fact[] = Array.isArray(d.facts) ? (d.facts as Fact[]) : [];
  if (!facts.length) collectFacts(raw, facts);
  const post: Raw = isObj(raw.postState) ? raw.postState : {};
  const output: Raw = isObj(raw.output) ? raw.output : {};
  const description = str(raw.description);
  const reason =
    str(d.reason) ?? str(output.reason) ?? str(post.refusalReason) ?? str(raw.reason) ?? str(raw.summary) ??
    (description && description !== title ? description : undefined);
  const loc = isObj(d.location) ? d.location : isObj(raw.location) ? raw.location : undefined;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const verdict = str(d.verdict) ?? (explicit || !rawState ? labels[state] : sentenceCase(rawState));
  return {
    id,
    title,
    state,
    verdict,
    reason,
    facts,
    sources: Array.isArray(d.sources) ? (d.sources as Source[]) : collectSources(raw, explorer),
    location: loc
      ? { lat: num(loc.lat) ?? num(loc.latitude), lng: num(loc.lng) ?? num(loc.longitude), place: str(loc.place) }
      : undefined,
    // A display-only case still has an input (its facts) and an output (its decision).
    request: raw.input ?? raw.intent ?? raw.preState ?? (facts.length ? Object.fromEntries(facts.map((f) => [f.label, f.value])) : undefined),
    response: raw.output ?? raw.postState ?? { state: rawState || state, verdict, ...(reason ? { reason } : {}) },
  };
}

function stepKind(step: Raw): DemoStep["kind"] {
  if (step.fill) return "fill";
  if (step.click) return "click";
  if (step.goto) return "open";
  return "wait";
}

/* ----------------------------------------------------------------- gate evidence */

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

const pct1 = (p: number) => `${(p * 100).toFixed(1)}%`;
const shortText = (text: string) => (text.length > 64 ? `${text.slice(0, 64)}…` : text);

function buildGateBlock(): GateBlock {
  const calibration = calibrationJson as unknown as {
    modelId: string;
    dtype: string;
    seed: number;
    split: { calibrationIds: string[]; heldoutIds: string[]; calibrationSize: number; heldoutSize: number };
    gate: {
      thresholds: { autoConfidence: number; maxEntropyBits: number };
      heldout: {
        total: number;
        autoHandled: number;
        escalated: number;
        coverage: number;
        accuracyAtCoverage: number;
        wrongAutoActions: number;
        baselineAccuracy: number;
      };
    };
  };
  const captured = capturedJson as unknown as { runs: CapturedRun[] };
  const tau = calibration.gate.thresholds.autoConfidence;
  const maxEntropyBits = calibration.gate.thresholds.maxEntropyBits;
  const held = calibration.gate.heldout;
  const first = captured.runs[0];
  const emptyExample: GateExample = {
    id: first?.id ?? "",
    textShort: shortText(first?.text ?? ""),
    prediction: first?.prediction ?? "",
    confidence: first?.confidence ?? 0,
    entropyBits: first?.entropyBits ?? 0,
    probabilities: first?.probabilities ?? {},
  };
  return {
    tau,
    maxEntropyBits,
    modelId: calibration.modelId,
    dtype: calibration.dtype,
    seed: calibration.seed,
    totalRuns: captured.runs.length,
    calibTotal: calibration.split.calibrationSize,
    heldTotal: calibration.split.heldoutSize,
    labelCount: first ? Object.keys(first.probabilities).length : 0,
    autoHeld: held.autoHandled,
    escalatedHeld: held.escalated,
    wrongHeld: held.wrongAutoActions,
    accuracyHeld: held.accuracyAtCoverage,
    baselineHeld: held.baselineAccuracy,
    coverageHeld: held.coverage,
    example: emptyExample,
  };
}

/**
 * Landing evidence cases, built from the held-out captured runs (committed
 * order): the first auto-handled correct decision, every wrong auto-action,
 * and the first two escalations. The verdict chips reuse the brief's four
 * state words: auto-handled reads Confident, a wrong auto reads Uncertain,
 * an escalation reads Needs review.
 */
function buildGateCases(gate: GateBlock): { cases: SampleCase[]; example: GateExample } {
  const captured = capturedJson as unknown as { runs: CapturedRun[] };
  const calibration = calibrationJson as unknown as { split: { heldoutIds: string[] } };
  const byId = new Map(captured.runs.map((r) => [r.id, r]));
  const held = calibration.split.heldoutIds.map((id) => byId.get(id)).filter((r): r is CapturedRun => Boolean(r));
  const isAuto = (r: CapturedRun) => r.confidence >= gate.tau && r.entropyBits <= gate.maxEntropyBits;

  const toExample = (r: CapturedRun): GateExample => ({
    id: r.id,
    textShort: shortText(r.text),
    prediction: r.prediction,
    confidence: r.confidence,
    entropyBits: r.entropyBits,
    probabilities: r.probabilities,
  });

  const cases: SampleCase[] = [];
  const autoExample = held.find((r) => isAuto(r) && r.correct);
  if (autoExample) {
    cases.push({
      id: autoExample.id,
      title: `“${shortText(autoExample.text)}” → ${autoExample.prediction} at ${pct1(autoExample.confidence)}`,
      state: "clear",
      verdict: "Auto-handled",
      reason: `Confidence ${autoExample.confidence} clears ${gate.tau}; entropy ${autoExample.entropyBits} bits within ${gate.maxEntropyBits}. Code decided, not the model.`,
      facts: [
        { label: "Confidence", value: pct1(autoExample.confidence) },
        { label: "Entropy", value: `${autoExample.entropyBits} bits` },
        { label: "Held-out coverage", value: pct1(gate.coverageHeld) },
      ],
      sources: [{ label: "evidence/captured-runs.json", detail: autoExample.id }],
    });
  }
  for (const r of held.filter((r) => isAuto(r) && !r.correct)) {
    cases.push({
      id: r.id,
      title: `“${shortText(r.text)}” → ${r.prediction} (gold: ${r.gold})`,
      state: "flagged",
      verdict: "Wrong auto-action",
      reason: `Auto-handled at ${pct1(r.confidence)} confidence but the gold label is ${r.gold}. Counted on the gate report, never hidden.`,
      facts: [
        { label: "Confidence", value: pct1(r.confidence) },
        { label: "Entropy", value: `${r.entropyBits} bits` },
        { label: "Gold label", value: r.gold },
      ],
      sources: [{ label: "evidence/captured-runs.json", detail: r.id }],
    });
  }
  for (const r of held.filter((r) => !isAuto(r)).slice(0, 2)) {
    cases.push({
      id: r.id,
      title: `“${shortText(r.text)}” → ${r.prediction} held`,
      state: "pending",
      verdict: "Escalated for human",
      reason: `Confidence ${r.confidence} / entropy ${r.entropyBits} bits misses the bar (≥ ${gate.tau}, ≤ ${gate.maxEntropyBits}). Queued for a human.`,
      facts: [
        { label: "Confidence", value: pct1(r.confidence) },
        { label: "Entropy", value: `${r.entropyBits} bits` },
        { label: "Gold label", value: r.gold },
      ],
      sources: [{ label: "evidence/captured-runs.json", detail: r.id }],
    });
  }
  return { cases, example: autoExample ? toExample(autoExample) : gate.example };
}

/* ----------------------------------------------------------------- entry point */

export function loadLanding(): LandingData {
  const brief = briefJson as unknown as Brief;
  const fixture = fixtureJson as unknown as Fixture;
  const demoPath = demoPathJson as unknown as { steps?: unknown[] };
  const landing = brief.landing ?? {};

  const stateLabels: Record<DecisionState, string> = {
    clear: "Clear",
    flagged: "Flagged",
    pending: "Needs your answer",
    refused: "Refused",
    ...(landing.stateLabels ?? {}),
  };

  const list = Array.isArray(fixture.cases) && fixture.cases.length ? fixture.cases : Array.isArray(fixture.runs) ? fixture.runs : [];
  const rawCases = list.filter(isObj);
  const fallbackCases = rawCases.map((c, i) => normalizeCase(c, i, stateLabels, str(fixture.explorerUrl)));

  // Landing evidence is the calibrated gate, not the old token fixtures:
  // curated held-out decisions (auto-handled, wrong auto-actions, escalations).
  const gate = buildGateBlock();
  const built = buildGateCases(gate);
  gate.example = built.example;
  const cases = built.cases.length > 0 ? built.cases : fallbackCases;
  const featured =
    cases.find((c) => c.state === "clear") ??
    cases.find((c) => c.state === "flagged") ??
    cases.find((c) => c.state === "pending") ??
    cases[0];

  const counts: Record<DecisionState, number> = { clear: 0, flagged: 0, pending: 0, refused: 0 };
  for (const c of cases) counts[c.state] += 1;

  const persona =
    typeof landing.persona === "string"
      ? str(landing.persona)
      : landing.persona?.name
        ? [landing.persona.name, landing.persona.role].filter(Boolean).join(", ")
        : undefined;

  const steps = (Array.isArray(demoPath.steps) ? demoPath.steps : [])
    .filter(isObj)
    .filter((s) => str(s.say) && !(s.goto === "/" && !s.click))
    .map((s) => ({ say: String(s.say), kind: stepKind(s) }));

  const generated = str(fixture.generatedAt ?? undefined);
  const checkedAt =
    generated && fixture.summary?.status !== "NOT_GENERATED" && cases.length
      ? new Date(generated).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
      : undefined;

  return {
    name: str(landing.name) ?? str(brief.name) ?? titleCase(str(brief.project) ?? "Project"),
    promise: str(landing.promise),
    idea: str(landing.usp) ?? str(brief.idea) ?? "",
    audience: undefined,
    problem: str(landing.problem) ?? str(brief.wedge?.painful_moment),
    boundary: str(landing.boundary),
    persona,
    cta: str(landing.cta) ?? "Open the app",
    trust: (landing.trust ?? []).filter((t): t is string => typeof t === "string" && t.trim().length > 0),
    stateLabels,
    cases,
    featured,
    counts,
    steps,
    gate,
    checkedAt,
    fixturePath: FIXTURE_PATH,
    setupHint: `Add sample cases to ${FIXTURE_PATH}`,
    design: resolveDesign(brief.design, str(brief.accent)),
  };
}
