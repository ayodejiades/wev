/**
 * lib/jevify.ts — Dual-mode wrapper (Jevify without losing the model's normal
 * abilities).
 *
 * `jevify(adapter, deciderSpec, thresholds)` returns { decide, generate, route }:
 * - decide(input): scores the decider in one pass and returns the typed result
 *   plus the verdict (AUTO | FALLBACK | ESCALATE). AUTO comes straight from the
 *   calibrated gate; FALLBACK means the gate said ESCALATE on a well-formed
 *   input and the adapter can generate, so System 2 text is on offer;
 *   ESCALATE is fail-closed (malformed input, or a score-only adapter).
 * - generate(input, opts): straight passthrough to the model's normal text
 *   generation with the raw input — prompts and behaviour untouched.
 * - route(input): AUTO returns the typed value; FALLBACK calls generate()
 *   exactly once and labels the text as an unverified System 2 fallback
 *   (generated text has NO calibrated confidence and is never claimed
 *   correct); ESCALATE queues the item for a human.
 *
 * Score-only adapters (pre-scored files) have no generate(): it throws a
 * clear error and routing falls to ESCALATE.
 */

import {
  decide as runDecider,
  DeciderError,
  type DeciderAdapter,
  type DeciderOutput,
  type DeciderSpec,
  type GenerateOptions,
  type GeneratedText,
} from "./decider";
import {
  GATE_THRESHOLDS,
  gateDeciderOutput,
  type GateDecision,
  type GateThresholds,
} from "./kernel";

export type JevifyVerdict = "AUTO" | "FALLBACK" | "ESCALATE";

export interface JevifyDecision extends DeciderOutput {
  gate: GateDecision;
  verdict: JevifyVerdict;
  reason: string;
}

export type JevifyRoute =
  | {
      path: "AUTO";
      value: string;
      confidence: number;
      probabilities: Record<string, number>;
      gate: GateDecision;
    }
  | {
      path: "FALLBACK";
      value: string;
      text: string;
      unverified: true;
      warning: string;
      gate: GateDecision;
    }
  | { path: "ESCALATE"; reason: string; gate: GateDecision };

export const FALLBACK_WARNING =
  "System 2 fallback: this text is generated, NOT decided: it carries no calibrated confidence and must not be treated as verified or correct.";

function wellFormed(gate: GateDecision): boolean {
  const inv1 = gate.invariants.find((i) => i.id === "INV-1");
  const inv2 = gate.invariants.find((i) => i.id === "INV-2");
  return (inv1?.passed ?? false) && (inv2?.passed ?? false);
}

export function jevify(adapter: DeciderAdapter, spec: DeciderSpec, thresholds: GateThresholds = GATE_THRESHOLDS) {
  /**
   * Score the decider in one pass; typed result plus AUTO | FALLBACK | ESCALATE.
   * FALLBACK is a routing offer, not a calibrated claim: the gate itself stays
   * binary (AUTO vs ESCALATE) exactly as calibrated.
   */
  async function decide(input: string): Promise<JevifyDecision> {
    const output = await runDecider(adapter, spec, input);
    const gate = gateDeciderOutput(output, input, thresholds);
    let verdict: JevifyVerdict;
    let reason: string;
    if (gate.verdict === "AUTO") {
      verdict = "AUTO";
      reason = `Calibrated gate auto-handles "${output.value}" (confidence ${output.confidence}).`;
    } else if (wellFormed(gate) && adapter.generate) {
      verdict = "FALLBACK";
      reason = `Gate escalated a well-formed input and the adapter can generate; System 2 fallback on offer (${FALLBACK_WARNING})`;
    } else {
      verdict = "ESCALATE";
      reason = adapter.generate
        ? `Malformed decider output fails closed: ${gate.reason}`
        : `Score-only adapter (${adapter.adapterKind}) has no text generation: ${gate.reason}`;
    }
    return { ...output, gate, verdict, reason };
  }

  /** Straight passthrough to the model's normal generation. Throws on score-only adapters. */
  async function generate(input: string, opts?: GenerateOptions): Promise<GeneratedText> {
    if (!adapter.generate) {
      throw new DeciderError(
        `score-only adapter (${adapter.adapterKind}) has no text generation; route to ESCALATE instead`
      );
    }
    return adapter.generate(input, opts);
  }

  /** Route one input down the path its verdict names. */
  async function route(input: string, opts?: GenerateOptions): Promise<JevifyRoute> {
    const decision = await decide(input);
    if (decision.verdict === "AUTO") {
      return {
        path: "AUTO",
        value: decision.value,
        confidence: decision.confidence,
        probabilities: decision.probabilities,
        gate: decision.gate,
      };
    }
    if (decision.verdict === "FALLBACK") {
      const { text } = await generate(input, opts);
      return {
        path: "FALLBACK",
        value: decision.value,
        text,
        unverified: true,
        warning: FALLBACK_WARNING,
        gate: decision.gate,
      };
    }
    return { path: "ESCALATE", reason: decision.reason, gate: decision.gate };
  }

  return { decide, generate, route };
}
