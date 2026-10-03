/**
 * lib/evidence-manifest.ts — the digests of the evidence this build was checked
 * against (evidence/evidence-manifest.json, written by `pnpm claim:verify`).
 *
 * Imported statically, like `lib/kernel.ts` imports thresholds.json, so a page
 * or a receipt can name its evidence without touching the filesystem. The file
 * always exists; `referenceModel` is null when no reference-model run has been
 * recorded, which is the normal state — the reference model is optional and the
 * app never imports reference-labels.json (a page must not break when it is
 * absent).
 */

import manifestDoc from "../evidence/evidence-manifest.json";

export interface EvidenceManifest {
  kind: string;
  version: number;
  files: Record<string, string>;
  goldSource: string;
  referenceModel: string | null;
}

export const EVIDENCE_MANIFEST = manifestDoc as unknown as EvidenceManifest;

/** The recorded reference model, or null when no reference run is committed. */
export function referenceModelRecorded(): string | null {
  return EVIDENCE_MANIFEST?.referenceModel ?? null;
}

/** True when a reference-labels.json is part of the committed evidence. */
export function referenceEvidenceRecorded(): boolean {
  return typeof EVIDENCE_MANIFEST?.files?.["reference-labels.json"] === "string";
}