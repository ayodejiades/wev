/**
 * lib/calibrate.ts — Shared seeded calibration for the act-or-escalate gate.
 *
 * Used by tools/calibrate.ts (`pnpm calibrate`, on captured runs) AND by
 * app/calibrate/page.tsx (on the user's own items in the browser). One
 * implementation, no duplication: seeded 50/50 split, threshold search on the
 * calibration half, accuracy-at-coverage report on the held-out half.
 *
 * Gate rule: AUTO iff confidence >= autoConfidence AND
 * entropyBits <= maxEntropyBits, else ESCALATE.
 */

export const CALIBRATION_SEED = 42;

/** Fewer items leave <10 per half: thresholds picked on tiny halves overfit. */
export const MIN_CALIBRATION_ITEMS = 20;

export interface ScoredItem {
  id: string;
  confidence: number;
  entropyBits: number;
  correct: boolean;
}

export interface PickedThresholds {
  autoConfidence: number;
  maxEntropyBits: number;
}

export interface SplitReport {
  total: number;
  autoHandled: number;
  escalated: number;
  coverage: number;
  accuracyAtCoverage: number;
  wrongAutoActions: number;
  baselineAccuracy: number;
  baselineWrong: number;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded 50/50 split: first floor(n/2) shuffled items calibrate, the rest is held out. */
export function seededSplit<T extends { id: string }>(
  items: T[],
  seed: number = CALIBRATION_SEED
): { calibration: T[]; heldout: T[] } {
  const rand = mulberry32(seed);
  const order = items.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const half = Math.floor(order.length / 2);
  return {
    calibration: order.slice(0, half).map((i) => items[i]),
    heldout: order.slice(half).map((i) => items[i]),
  };
}

export function accuracyOf(rows: Array<{ correct: boolean }>): number {
  if (rows.length === 0) return 0;
  return rows.filter((r) => r.correct).length / rows.length;
}

const CONFIDENCE_GRID: number[] = [];
for (let c = 0.5; c <= 0.9501; c += 0.05) CONFIDENCE_GRID.push(Math.round(c * 100) / 100);
const ENTROPY_GRID = [3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0, 99];

/**
 * Pick AUTO-vs-ESCALATE thresholds on the calibration items only: maximize
 * accuracy on auto-handled items; tie-break higher coverage, then lower
 * confidence bar, then higher entropy bar. Combos with zero coverage are
 * skipped. Returns null when nothing auto-handles (report coverage 0
 * honestly instead of guessing).
 */
export function pickThresholds(calibration: ScoredItem[]): PickedThresholds | null {
  let best: (PickedThresholds & { coverage: number; acc: number }) | null = null;
  for (const autoConfidence of CONFIDENCE_GRID) {
    for (const maxEntropyBits of ENTROPY_GRID) {
      const auto = calibration.filter((r) => r.confidence >= autoConfidence && r.entropyBits <= maxEntropyBits);
      const coverage = auto.length / calibration.length;
      if (auto.length === 0) continue;
      const acc = accuracyOf(auto);
      if (
        best === null ||
        acc > best.acc ||
        (acc === best.acc && coverage > best.coverage) ||
        (acc === best.acc && coverage === best.coverage && autoConfidence < best.autoConfidence) ||
        (acc === best.acc &&
          coverage === best.coverage &&
          autoConfidence === best.autoConfidence &&
          maxEntropyBits > best.maxEntropyBits)
      ) {
        best = { autoConfidence, maxEntropyBits, coverage, acc };
      }
    }
  }
  return best === null ? null : { autoConfidence: best.autoConfidence, maxEntropyBits: best.maxEntropyBits };
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Accuracy-at-coverage report for one split under the picked thresholds. */
export function gateReport(items: ScoredItem[], thresholds: PickedThresholds): SplitReport {
  const auto = items.filter((r) => r.confidence >= thresholds.autoConfidence && r.entropyBits <= thresholds.maxEntropyBits);
  const wrongAuto = auto.filter((r) => !r.correct).length;
  return {
    total: items.length,
    autoHandled: auto.length,
    escalated: items.length - auto.length,
    coverage: items.length ? round4(auto.length / items.length) : 0,
    accuracyAtCoverage: auto.length ? round4(accuracyOf(auto)) : 0,
    wrongAutoActions: wrongAuto,
    baselineAccuracy: round4(accuracyOf(items)),
    baselineWrong: items.filter((r) => !r.correct).length,
  };
}

// ---------------------------------------------------------------------------
// Second label source (OPTIONAL): score the same held-out split against an
// independent labeller instead of only against the author's gold labels.
// Shared by tools/calibrate.ts (writes it) and tools/verify-evidence.ts
// (recomputes it and fails on any mismatch).
// ---------------------------------------------------------------------------

/** A captured run that also carries a reference-model label for the same id. */
export interface ReferenceRun extends ScoredItem {
  prediction: string;
  gold: string;
  referenceLabel: string;
}

export interface Agreement {
  agree: number;
  total: number;
  rate: number;
}

export interface ReferenceCheck {
  referenceModel: string;
  referenceSha256: string;
  goldAgreement: Agreement;
  heldoutVsGold: SplitReport;
  heldoutVsReference: SplitReport;
  thresholdsAgreeOnVerdicts: { same: number; total: number };
}

/**
 * Re-score one split against both labellers. The gate verdict itself depends
 * only on confidence and entropy, so the two verdict sets are expected to be
 * identical; that is computed here rather than assumed.
 */
export function computeReferenceCheck(input: {
  heldout: ReferenceRun[];
  allRuns: ReferenceRun[];
  thresholds: PickedThresholds;
  referenceModel: string;
  referenceSha256: string;
}): ReferenceCheck {
  const { heldout, allRuns, thresholds } = input;
  const vsReference = (rows: ReferenceRun[]) =>
    rows.map((r) => ({ ...r, correct: r.prediction === r.referenceLabel }));
  const autoVerdict = (r: ScoredItem) =>
    r.confidence >= thresholds.autoConfidence && r.entropyBits <= thresholds.maxEntropyBits;
  let same = 0;
  for (let i = 0; i < heldout.length; i++) {
    if (autoVerdict(heldout[i]) === autoVerdict(vsReference(heldout)[i])) same++;
  }
  return {
    referenceModel: input.referenceModel,
    referenceSha256: input.referenceSha256,
    goldAgreement: (() => {
      // How often the reference model's label equals the author's label. This
      // is agreement between two labellers, NOT accuracy against truth (the
      // author's labels are synthetic) — and it is the same number the
      // evidence file stores as agreementWithGold.
      const agree = allRuns.filter((r) => r.referenceLabel === r.gold).length;
      const total = allRuns.length;
      return { agree, total, rate: total === 0 ? 0 : round4(agree / total) };
    })(),
    heldoutVsGold: gateReport(heldout, thresholds),
    heldoutVsReference: gateReport(vsReference(heldout), thresholds),
    thresholdsAgreeOnVerdicts: { same, total: heldout.length },
  };
}
