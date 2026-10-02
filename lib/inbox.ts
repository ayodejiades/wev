/**
 * lib/inbox.ts — Pure helpers for the inbox view (app/inbox/page.tsx).
 *
 * `selectInboxIds` takes the first N held-out ids in committed order, so every
 * run streams the same deterministic subset. `summarizeInbox` derives the live
 * counters (auto-handled, escalated, wrong auto-actions, always-trust wrong)
 * from streamed rows. Both are unit-tested; the page only renders.
 */

export interface InboxCounters {
  total: number;
  autoHandled: number;
  escalated: number;
  wrongAutoActions: number;
  alwaysTrustWrong: number;
}

/** First N ids in committed order; throws when fewer than N are available. */
export function selectInboxIds(heldoutIds: string[], n: number): string[] {
  if (heldoutIds.length < n) {
    throw new Error(`inbox needs ${n} held-out ids, only ${heldoutIds.length} committed`);
  }
  return heldoutIds.slice(0, n);
}

export function summarizeInbox(rows: Array<{ auto: boolean; correct: boolean }>): InboxCounters {
  const autoHandled = rows.filter((r) => r.auto).length;
  return {
    total: rows.length,
    autoHandled,
    escalated: rows.length - autoHandled,
    wrongAutoActions: rows.filter((r) => r.auto && !r.correct).length,
    alwaysTrustWrong: rows.filter((r) => !r.correct).length,
  };
}
