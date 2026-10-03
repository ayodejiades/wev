"use client";

// app/inbox/page.tsx — "Inbox: the gate at work". Streams the first 40
// held-out synthetic tickets through the in-browser SmolLM2 model via the
// shared triage adapter (lib/decider.ts) and jevify routing (lib/jevify.ts),
// showing each as auto-handled or escalated with live counters. In DEMO_MODE
// (or when /api/health is unreachable) it replays the committed captured runs
// through the same gate instead of calling the model, and says so.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import { ModelPicker, type AdapterKind } from "@/components/model-picker";
import { TRIAGE_DECIDER } from "@/lib/decider";
import { jevify } from "@/lib/jevify";
import { gateDeciderOutput } from "@/lib/kernel";
import {
  MODEL_PRESETS,
  explainLoadError,
  fetchModelSize,
  loadStoredThresholds,
  resolveModelThresholds,
} from "@/lib/models";
import {
  LOCAL_SERVER_DEFAULT_URL,
  createAdapterFromChoice,
  loadTriageAdapter,
  loadTriageAdapterFromFolder,
  parsePrescoredFile,
} from "@/lib/wev-model";
import { folderNameFor } from "@/lib/local-folder";
import { selectInboxIds, summarizeInbox } from "@/lib/inbox";
import { referenceModelRecorded } from "@/lib/evidence-manifest";
import { createReceipt, evidenceFromManifest } from "@/lib/receipt";
import { buildGateCard, buildGateCopyText, selectGateTestCases } from "@/lib/gate-export";
import calibrationData from "../../evidence/calibration.json";
import capturedData from "../../evidence/captured-runs.json";
import itemsData from "../../data/items.json";

interface ItemRow {
  id: string;
  text: string;
  gold: string;
}

interface CapturedRow {
  prediction: string;
  probabilities: Record<string, number>;
  confidence: number;
  entropyBits: number;
  correct: boolean;
}

interface InboxRowState {
  id: string;
  text: string;
  gold: string;
  probabilities: Record<string, number>;
  prediction: string;
  confidence: number;
  entropyBits: number | null;
  auto: boolean;
  fallbackReady: boolean;
  correct: boolean;
  fallbackText?: string;
  fallbackBusy?: boolean;
}

type Phase = "idle" | "checking" | "loading" | "streaming" | "done" | "error";

const INBOX_IDS = selectInboxIds(
  (calibrationData as { split: { heldoutIds: string[] } }).split.heldoutIds,
  40
);
const HELD_TOTAL = (calibrationData as { split: { heldoutSize: number } }).split.heldoutSize;
const COMMITTED_THRESHOLDS = {
  modelId: (calibrationData as { modelId: string }).modelId,
  autoConfidence: (calibrationData as { gate: { thresholds: { autoConfidence: number } } }).gate.thresholds
    .autoConfidence,
  maxEntropyBits: (calibrationData as { gate: { thresholds: { maxEntropyBits: number } } }).gate.thresholds
    .maxEntropyBits,
};
const CAPTURED_MODEL_ID = (capturedData as { modelId: string }).modelId;
/** Effective bar when a model has no thresholds: reachable by nothing. */
const UNREACHABLE_BAR = { autoConfidence: 1.01, maxEntropyBits: -1 };
const itemsById = new Map(
  ((itemsData as { items: ItemRow[] }).items.map((r) => [r.id, r]) as Array<[string, ItemRow]>)
);
const runsById = new Map(
  ((capturedData as { runs: Array<{ id: string } & CapturedRow> }).runs.map((r) => [r.id, r]) as Array<
    [string, { id: string } & CapturedRow]
  >)
);

/** The recorded reference model (null unless `pnpm reference` has been run). */
const RECORDED_REFERENCE_MODEL = referenceModelRecorded();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

const HELDOUT_IDS = (calibrationData as { split: { heldoutIds: string[] } }).split.heldoutIds;
const EXPORT_RUNS = HELDOUT_IDS.map((id) => runsById.get(id)!).filter(Boolean);

export default function InboxPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [mode, setMode] = useState<"live" | "replay" | null>(null);
  const [modeNote, setModeNote] = useState("");
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [rows, setRows] = useState<InboxRowState[]>([]);
  const [error, setError] = useState("");
  const [exportNote, setExportNote] = useState("");
  const [copiedId, setCopiedId] = useState("");
  const [modelId, setModelId] = useState(MODEL_PRESETS[0].id);
  const [failedIds, setFailedIds] = useState<string[]>([]);
  const [sizes, setSizes] = useState<Record<string, string>>({});
  const [customId, setCustomId] = useState("");
  const [stagedFolder, setStagedFolder] = useState<{ name: string; files: File[] } | null>(null);
  const [folderSummary, setFolderSummary] = useState<string | null>(null);
  const [adapterKind, setAdapterKind] = useState<AdapterKind>("onnx");
  const [serverUrl, setServerUrl] = useState(LOCAL_SERVER_DEFAULT_URL);
  const [serverModel, setServerModel] = useState("");
  const [prescored, setPrescored] = useState<{ fileName: string; raw: string } | null>(null);
  const [prescoredSummary, setPrescoredSummary] = useState<string | null>(null);
  const [storedAll, setStoredAll] = useState<ReturnType<typeof loadStoredThresholds>>({});
  const appRef = useRef<ReturnType<typeof jevify> | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    setStoredAll(loadStoredThresholds());
    let live = true;
    for (const p of MODEL_PRESETS) {
      fetchModelSize(p.id, p.dtype).then((r) => {
        if (live) setSizes((s) => ({ ...s, [p.id]: r.partial ? `${r.text} (partial)` : r.text }));
      });
    }
    return () => {
      live = false;
    };
  }, []);

  function pickFolder(files: File[]) {
    if (files.length === 0) return;
    const name = folderNameFor(files);
    setError("");
    setStagedFolder({ name, files });
    setFolderSummary(`Staged ${name}: ${files.length} files. Loads on Run. Nothing uploads.`);
    const id = `local-folder:${name}`;
    setModelId(id);
    setSizes((s) => ({ ...s, [id]: "local folder · no download" }));
  }

  const counters = summarizeInbox(rows.map((r) => ({ auto: r.auto, correct: r.correct })));
  const presetOf = (id: string) => MODEL_PRESETS.find((p) => p.id === id);
  /** Thresholds are keyed per model id; an adapter never inherits another's bar. */
  const activeModelId =
    adapterKind === "server"
      ? `server:${serverModel.trim() || "unnamed-server"}`
      : adapterKind === "prescored"
      ? `prescored:${prescored?.fileName ?? "no-file"}`
      : modelId;
  const activeShort =
    adapterKind === "onnx" ? (presetOf(modelId)?.short ?? modelId) : activeModelId;
  const activeDtype = presetOf(modelId)?.dtype ?? "uint8";
  const resolution = resolveModelThresholds(activeModelId, COMMITTED_THRESHOLDS, storedAll);
  const gateThresholds = resolution.thresholds ?? UNREACHABLE_BAR;
  const storedMeta = storedAll[activeModelId] as { calibratedAt?: string; items?: number } | undefined;

  function pickModel(id: string) {
    const clean = id.trim();
    if (!clean) return;
    if (!presetOf(clean) && !/^[^/\s]+\/[^/\s]+$/.test(clean)) {
      setError("Custom model id should look like owner/model-ONNX (letters, numbers, dashes, dots).");
      return;
    }
    setError("");
    setStagedFolder(null);
    setFolderSummary(null);
    setModelId(clean);
    if (!sizes[clean]) {
      fetchModelSize(clean, "uint8").then((r) =>
        setSizes((s) => ({ ...s, [clean]: r.partial ? `${r.text} (partial)` : r.text }))
      );
    }
  }

  function changeAdapter(kind: AdapterKind) {
    setAdapterKind(kind);
    setError("");
    setPrescoredSummary(kind === "prescored" && !prescored ? "No pre-scored file chosen yet." : null);
  }

  async function pickPrescored(file: File) {
    setError("");
    const raw = await file.text();
    try {
      const rows = parsePrescoredFile(file.name, raw, TRIAGE_DECIDER);
      const withoutEntropy = rows.findIndex((r) => r.entropyBits === null || r.entropyBits === undefined);
      if (withoutEntropy >= 0) {
        throw new Error(
          `Pre-scored row ${withoutEntropy} has no entropyBits. The calibrated gate has an entropy bar, so a row without full-vocabulary entropy cannot be gated honestly. Re-export the file with an entropyBits column.`
        );
      }
      setPrescored({ fileName: file.name, raw });
      setPrescoredSummary(`${file.name}: ${rows.length} pre-scored rows, no model needed.`);
    } catch (e) {
      setPrescored(null);
      setPrescoredSummary(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function runReplay(prefixNote: string) {
    setMode("replay");
    setModeNote(
      `${prefixNote}Replay of committed ${CAPTURED_MODEL_ID} runs with no model call (DEMO_MODE)${modelId !== CAPTURED_MODEL_ID ? `; selected ${modelId} not used in replay` : ""}. Verdicts still pass through the calibrated gate.`
    );
    setPhase("streaming");
    for (const id of INBOX_IDS) {
      if (cancelRef.current) break;
      const item = itemsById.get(id)!;
      const run = runsById.get(id)!;
      const gate = gateDeciderOutput(
        {
          value: run.prediction,
          probabilities: run.probabilities,
          confidence: run.confidence,
          entropyBits: run.entropyBits,
          modelId: (capturedData as { modelId: string }).modelId,
          deciderVersion: "captured-replay",
        },
        id
      );
      setRows((prev) => [
        ...prev,
        {
          id,
          text: item.text,
          gold: item.gold,
          probabilities: run.probabilities,
          prediction: run.prediction,
          confidence: run.confidence,
          entropyBits: run.entropyBits,
          auto: gate.auto,
          fallbackReady: false,
          correct: run.prediction === item.gold,
        },
      ]);
      await sleep(40);
    }
    setPhase("done");
  }

  async function runLive() {
    setMode("live");
    const sourceNote =
      resolution.source === "committed"
        ? "Committed evidence thresholds."
        : resolution.source === "stored"
        ? `Device thresholds for this model${storedMeta?.items ? ` (${storedMeta.items} items)` : ""}.`
        : "No thresholds for this model: nothing auto-handles. Calibrate it first; thresholds are never reused across models.";
    setModeNote(
      `Live: ${activeModelId} scoring (${adapterKind === "onnx" ? "first run downloads weights once" : adapterKind === "server" ? "EXPERIMENTAL local server, nothing uploaded from this page" : "pre-scored rows replayed, no model needed"}). ${sourceNote}`
    );
    setPhase("loading");
    let adapter;
    try {
      if (adapterKind === "server") {
        if (!serverModel.trim()) throw new Error("Name the model your local server serves, then run again.");
        adapter = createAdapterFromChoice(
          { kind: "server", baseUrl: serverUrl.trim() || LOCAL_SERVER_DEFAULT_URL, model: serverModel.trim() },
          TRIAGE_DECIDER
        );
      } else if (adapterKind === "prescored") {
        if (!prescored) throw new Error("Choose a pre-scored .csv or .json file first: it supplies the scores.");
        adapter = createAdapterFromChoice({ kind: "prescored", ...prescored }, TRIAGE_DECIDER);
      } else if (modelId.startsWith("local-folder:")) {
        const staged = stagedFolder;
        if (!staged || `local-folder:${staged.name}` !== modelId) {
          throw new Error("Drop the local folder again. Nothing is staged to load.");
        }
        const prog = (pct: number, label: string) => {
          setProgress(pct);
          setProgressLabel(label);
        };
        adapter = (await loadTriageAdapterFromFolder(staged.files, staged.name, prog)).adapter;
      } else {
        adapter = await loadTriageAdapter(
          (pct, label) => {
            setProgress(pct);
            setProgressLabel(label);
          },
          { modelId, dtype: activeDtype }
        );
      }
    } catch (e) {
      if (adapterKind !== "onnx") throw e; // adapter errors are shown verbatim
      if (presetOf(modelId)) setFailedIds((f) => (f.includes(modelId) ? f : [...f, modelId]));
      throw new Error(explainLoadError(e));
    }
    const app = jevify(adapter, TRIAGE_DECIDER, gateThresholds);
    appRef.current = app;
    setPhase("streaming");
    for (const id of INBOX_IDS) {
      if (cancelRef.current) break;
      const item = itemsById.get(id)!;
      const decided = await app.decide(item.text);
      setRows((prev) => [
        ...prev,
        {
          id,
          text: item.text,
          gold: item.gold,
          probabilities: decided.probabilities,
          prediction: decided.value,
          confidence: decided.confidence,
          entropyBits: decided.entropyBits,
          auto: decided.verdict === "AUTO",
          fallbackReady: decided.verdict === "FALLBACK",
          correct: decided.value === item.gold,
        },
      ]);
    }
    setPhase("done");
  }

  async function run() {
    cancelRef.current = false;
    appRef.current = null;
    setRows([]);
    setError("");
    setMode(null);
    setModeNote("");
    setProgress(0);
    setProgressLabel("");
    setPhase("checking");
    try {
      let demoMode = true;
      let prefixNote = "";
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch("/api/health", { signal: ctrl.signal, cache: "no-store" });
        clearTimeout(timer);
        const body = (await res.json()) as { demoMode?: boolean };
        demoMode = body?.demoMode === true;
      } catch {
        prefixNote = "Could not reach /api/health (offline?). ";
      }
      if (demoMode) {
        await runReplay(prefixNote);
      } else {
        await runLive();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  async function generateFallback(id: string) {
    const app = appRef.current;
    if (!app) return;
    const item = rows.find((r) => r.id === id);
    if (!item) return;
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, fallbackBusy: true } : r)));
    try {
      const { text } = await app.generate(item.text, { maxNewTokens: 24 });
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, fallbackText: text, fallbackBusy: false } : r)));
    } catch (e) {
      setRows((prev) =>
        prev.map((r) =>
          r.id === id
            ? { ...r, fallbackText: `Fallback failed: ${e instanceof Error ? e.message : String(e)}`, fallbackBusy: false }
            : r
        )
      );
    }
  }

  async function copyGate() {
    if (activeModelId !== COMMITTED_THRESHOLDS.modelId) {
      setExportNote("This model's gate copies from /calibrate after you calibrate it: test cases must come from its own runs.");
      return;
    }
    if (!resolution.thresholds) {
      setExportNote("No thresholds for this model: calibrate it first; nothing is exported.");
      return;
    }
    const cases = selectGateTestCases(EXPORT_RUNS, gateThresholds);
    const src = buildGateCopyText({
      modelId: activeModelId,
      decider: (capturedData as { decider: string }).decider,
      thresholds: gateThresholds,
      cases,
    });
    const ok = await copyText(src);
    setExportNote(
      ok
        ? `Copied ${src.split("\n").length} lines: triageGate() with baked thresholds plus ${cases.length} evidence test cases.`
        : "Copy failed: the browser blocked clipboard access."
    );
  }

  function downloadGateCard() {
    if (activeModelId !== COMMITTED_THRESHOLDS.modelId) {
      setExportNote("This model's gate card downloads from /calibrate after you calibrate it: the held-out report here belongs to the committed model.");
      return;
    }
    const cal = calibrationData as {
      modelId: string;
      dtype: string;
      seed: number;
      split: { calibrationSize: number; heldoutSize: number };
      gate: { heldout: Record<string, number> };
      generatedAt: string;
      syntheticDataNote: string;
    };
    const firstRun = (capturedData as { runs: Array<{ probabilities: Record<string, number> }> }).runs[0];
    const card = buildGateCard({
      modelId: cal.modelId,
      dtype: cal.dtype,
      decider: (capturedData as { decider: string }).decider,
      thresholds: gateThresholds,
      seed: cal.seed,
      calibrationSize: cal.split.calibrationSize,
      heldoutSize: cal.split.heldoutSize,
      heldout: {
        coverage: cal.gate.heldout.coverage,
        accuracyAtCoverage: cal.gate.heldout.accuracyAtCoverage,
        baselineAccuracy: cal.gate.heldout.baselineAccuracy,
        wrongAutoActions: cal.gate.heldout.wrongAutoActions,
        autoHandled: cal.gate.heldout.autoHandled,
        total: cal.gate.heldout.total,
      },
      calibratedAt: cal.generatedAt,
      syntheticDataNote: cal.syntheticDataNote,
      labelCount: Object.keys(firstRun.probabilities).length,
      totalItems: (capturedData as { total: number }).total,
      // The committed evidence run this card's thresholds came from.
      evidence: (() => {
        try {
          return evidenceFromManifest();
        } catch {
          return null;
        }
      })(),
    });
    const blob = new Blob([JSON.stringify(card, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gate-card.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setExportNote(
      `Downloaded gate-card.json: held-out ${cal.gate.heldout.autoHandled}/${cal.gate.heldout.total} auto at ${(cal.gate.heldout.accuracyAtCoverage * 100).toFixed(1)}% vs ${(cal.gate.heldout.baselineAccuracy * 100).toFixed(1)}% baseline.`
    );
  }

  async function copyReceipt(row: InboxRowState) {
    if (row.entropyBits === null) {
      setExportNote("No full-vocabulary entropy for this row; nothing honest to pin to a receipt.");
      return;
    }
    try {
      const receipt = await createReceipt({
        id: row.id,
        input: row.text,
        modelId: activeModelId,
        deciderVersion: TRIAGE_DECIDER.version,
        probabilities: row.probabilities,
        confidence: row.confidence,
        entropyBits: row.entropyBits,
        prediction: row.prediction,
        thresholds: gateThresholds,
        verdict: row.auto ? "AUTO" : "ESCALATE",
        path: row.auto ? "AUTO" : row.fallbackReady ? "FALLBACK" : "ESCALATE",
      });
      const ok = await copyText(JSON.stringify(receipt, null, 2));
      if (ok) {
        setCopiedId(row.id);
        setExportNote(`Copied receipt for ${row.id}. Paste it into /verify to re-check the hash and verdict.`);
      } else {
        setExportNote("Copy failed: the browser blocked clipboard access.");
      }
    } catch (e) {
      setExportNote(`Receipt failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const running = phase === "checking" || phase === "loading" || phase === "streaming";

  return (
    <DashboardShell project="WEV">
      <div className="flex flex-col gap-6 py-2">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-[#0a0a0a] pb-4 sm:pb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="shrink-0 border border-[#0a0a0a] bg-[#0a0a0a] px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider text-white">
                GATE.INBOX
              </span>
              <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-[#0a0a0a]">
                Inbox: the gate at work
              </h1>
            </div>
            <p className="mt-1 max-w-2xl text-xs text-[#525252]">
              {INBOX_IDS.length} of {HELD_TOTAL} held-out synthetic tickets through {activeShort} ({activeModelId}),
              one by one. Gold labels are synthetic (data/items.json).
            </p>
            <p className="mt-1 max-w-2xl text-xs text-[#525252]">
              Reference model: optional audit, off by default.
              {RECORDED_REFERENCE_MODEL ? ` Recorded here: ${RECORDED_REFERENCE_MODEL}.` : ""}
            </p>
          </div>
          <div className="flex w-full sm:w-auto gap-2">
            {!running ? (
              <button
                type="button"
                onClick={run}
                data-demo="inbox-run"
                style={{ color: "#ffffff", backgroundColor: "#0a0a0a" }}
                className="w-full sm:w-auto text-center shrink-0 border-2 border-[#0a0a0a] bg-[#0a0a0a] !text-white px-5 py-2.5 font-mono text-xs font-bold shadow-[2px_2px_0_0_#0047ff] hover:-translate-y-0.5 transition-transform cursor-pointer"
              >
                <span className="!text-white text-white font-bold" style={{ color: "#ffffff" }}>
                  {rows.length > 0 ? "Run again" : "Run inbox"}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  cancelRef.current = true;
                }}
                className="w-full sm:w-auto text-center shrink-0 border-2 border-[#0a0a0a] bg-[#ffffff] px-5 py-2.5 font-mono text-xs font-bold text-[#0a0a0a] shadow-[2px_2px_0_0_#0a0a0a]"
              >
                Stop
              </button>
            )}
          </div>
        </div>

        <ModelPicker
          presets={MODEL_PRESETS}
          selectedId={modelId}
          failedIds={failedIds}
          sizes={sizes}
          customId={customId}
          onCustomIdChange={setCustomId}
          onPick={pickModel}
          folderSummary={folderSummary}
          onPickFolder={pickFolder}
          adapter={{
            kind: adapterKind,
            onAdapterChange: changeAdapter,
            serverUrl,
            onServerUrlChange: setServerUrl,
            serverModel,
            onServerModelChange: setServerModel,
            prescoredSummary,
            onPickPrescored: (file) => void pickPrescored(file),
          }}
        />

        {resolution.source !== "committed" && (
          <div className="border-2 border-[#d97706] bg-[#d97706]/10 p-2.5 font-mono text-[11px] text-[#0a0a0a]">
            {resolution.source === "stored"
              ? `Device thresholds for ${activeShort} apply here (saved on this device). Committed evidence thresholds belong to ${COMMITTED_THRESHOLDS.modelId} only.`
              : `No thresholds for ${activeShort} on this device: nothing auto-handles until it is calibrated. Thresholds are never reused across models.`}
          </div>
        )}

        {modeNote && (
          <div className="border-2 border-[#0a0a0a] bg-[#ece8df] p-2.5 font-mono text-[11px] text-[#0a0a0a]">
            {modeNote}
          </div>
        )}

        {(phase === "loading" || phase === "streaming") && (
          <div className="flex flex-col gap-1.5 border-2 border-[#0a0a0a] bg-[#ffffff] p-3.5 shadow-[4px_4px_0_0_#0a0a0a]">
            <div className="h-3 overflow-hidden border-2 border-[#0a0a0a] bg-[#ece8df]">
              {phase === "loading" ? (
                <div className="h-full bg-[#0047ff] transition-all" style={{ width: `${progress}%` }} />
              ) : (
                <div
                  className="h-full bg-[#0a0a0a] transition-all"
                  style={{ width: `${Math.round((rows.length / INBOX_IDS.length) * 100)}%` }}
                />
              )}
            </div>
            <span className="font-mono text-[11px] text-[#525252]">
              {phase === "loading"
                ? `Loading model ${progress}% · ${progressLabel}`
                : `Item ${rows.length} / ${INBOX_IDS.length} · ${mode === "replay" ? "replaying" : "scoring live"}`}
            </span>
          </div>
        )}

        {phase === "error" && (
          <p className="border-2 border-[#dc2626] bg-[#dc2626]/10 p-3 font-mono text-xs text-[#dc2626]">{error}</p>
        )}

        {/* Live counters */}
        {(rows.length > 0 || running) && (
          <section className="grid grid-cols-2 gap-2 sm:gap-3 sm:grid-cols-4">
            <div className="border-2 border-[#0a0a0a] bg-[#ffffff] p-2.5 sm:p-4 shadow-[3px_3px_0_0_#0a0a0a]">
              <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#16a34a]">
                Auto-handled
              </div>
              <div className="mt-1 font-mono text-xl sm:text-2xl font-bold text-[#16a34a]">
                {counters.autoHandled} / {INBOX_IDS.length}
              </div>
              <div className="mt-0.5 sm:mt-1 font-mono text-[10px] sm:text-[11px] text-[#525252]">
                gate said AUTO
              </div>
            </div>

            <div className="border-2 border-[#0a0a0a] bg-[#ffffff] p-2.5 sm:p-4 shadow-[3px_3px_0_0_#0a0a0a]">
              <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#d97706]">
                Escalated
              </div>
              <div className="mt-1 font-mono text-xl sm:text-2xl font-bold text-[#d97706]">
                {counters.escalated} / {INBOX_IDS.length}
              </div>
              <div className="mt-0.5 sm:mt-1 font-mono text-[10px] sm:text-[11px] text-[#525252]">
                needs a human
              </div>
            </div>

            <div className="border-2 border-[#0a0a0a] bg-[#ffffff] p-2.5 sm:p-4 shadow-[3px_3px_0_0_#0a0a0a]">
              <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#dc2626]">
                Wrong auto-actions
              </div>
              <div className="mt-1 font-mono text-xl sm:text-2xl font-bold text-[#dc2626]">
                {counters.wrongAutoActions}
              </div>
              <div className="mt-0.5 sm:mt-1 font-mono text-[10px] sm:text-[11px] text-[#525252]">
                auto-handled but incorrect
              </div>
            </div>

            <div className="border-2 border-[#0a0a0a] bg-[#ffffff] p-2.5 sm:p-4 shadow-[3px_3px_0_0_#0a0a0a]">
              <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#525252]">
                Always-trust wrong
              </div>
              <div className="mt-1 font-mono text-xl sm:text-2xl font-bold text-[#525252]">
                {counters.alwaysTrustWrong}
              </div>
              <div className="mt-0.5 sm:mt-1 font-mono text-[10px] sm:text-[11px] text-[#525252]">
                model top-1 vs gold
              </div>
            </div>
          </section>
        )}

        {/* Export the gate */}
        <section className="flex flex-col gap-3 border-2 border-[#0a0a0a] bg-[#ffffff] p-3.5 sm:p-5 shadow-[4px_4px_0_0_#0a0a0a]">
          <div>
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#525252]">
              Export the gate
            </span>
            <h2 className="font-mono text-lg font-bold text-[#0a0a0a]">Take the thresholds with you</h2>
            <p className="mt-1 text-xs text-[#525252]">
              {resolution.thresholds
                ? `Confidence ≥ ${gateThresholds.autoConfidence}, entropy ≤ ${gateThresholds.maxEntropyBits} bits (${resolution.source === "committed" ? "committed evidence" : "saved on this device"}). Every receipt below re-verifies on /verify.`
                : "No thresholds for this model yet: calibrate it first. Nothing below is exported."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-demo="copy-gate"
              onClick={copyGate}
              style={{ color: "#ffffff", backgroundColor: "#0a0a0a" }}
              className="w-full sm:w-auto text-center border-2 border-[#0a0a0a] bg-[#0a0a0a] !text-white px-4 py-2 font-mono text-xs font-bold shadow-[2px_2px_0_0_#0047ff] hover:-translate-y-0.5 transition-transform cursor-pointer"
            >
              <span className="!text-white text-white font-bold" style={{ color: "#ffffff" }}>
                Copy gate
              </span>
            </button>
            <button
              type="button"
              data-demo="gate-card"
              onClick={downloadGateCard}
              className="w-full sm:w-auto text-center border-2 border-[#0a0a0a] bg-[#ffffff] px-4 py-2 font-mono text-xs font-bold text-[#0a0a0a] shadow-[2px_2px_0_0_#0a0a0a] hover:-translate-y-0.5 transition-transform"
            >
              Download gate card
            </button>
          </div>
          {exportNote && <p className="font-mono text-[11px] text-[#0a0a0a]">{exportNote}</p>}
        </section>

        {/* Streamed rows */}
        <section data-demo="inbox-rows" className="flex flex-col gap-2.5 sm:gap-3">
          {rows.length === 0 && !running && phase !== "error" && (
            <div className="border-2 border-dashed border-[#0a0a0a] bg-[#ffffff] p-6 text-center shadow-[3px_3px_0_0_#0a0a0a]">
              <p className="font-mono text-xs font-bold text-[#0a0a0a]">Inbox is ready</p>
              <p className="mt-1 font-mono text-[11px] text-[#525252]">
                Click &ldquo;Run inbox&rdquo; above to stream the 40 held-out tickets through the on-device gate.
              </p>
            </div>
          )}
          {rows.map((r) => {
            const wrong = r.auto && !r.correct;
            return (
              <div
                key={r.id}
                className={`border-2 bg-[#ffffff] p-3.5 sm:p-4 shadow-[3px_3px_0_0_#0a0a0a] ${
                  wrong ? "border-[#dc2626]" : "border-[#0a0a0a]"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
                  <span className="font-bold text-[#0a0a0a]">{r.id}</span>
                  <span className="flex flex-wrap gap-1.5">
                    <span
                      className={`border px-1.5 py-0.5 font-bold uppercase ${
                        r.auto ? "border-[#16a34a] text-[#16a34a]" : "border-[#d97706] text-[#d97706]"
                      }`}
                    >
                      {r.auto ? "Auto-handled" : "Escalated"}
                    </span>
                    {r.fallbackReady && mode === "live" && (
                      <span className="border border-[#0047ff] px-1.5 py-0.5 font-bold uppercase text-[#0047ff]">
                        fallback ready
                      </span>
                    )}
                    {wrong && (
                      <span className="border border-[#dc2626] bg-[#dc2626]/10 px-1.5 py-0.5 font-bold uppercase text-[#dc2626]">
                        wrong
                      </span>
                    )}
                  </span>
                </div>
                <p className="mt-2 text-xs font-semibold text-[#0a0a0a]">&ldquo;{r.text}&rdquo;</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-[#525252]">
                  <span>
                    predicted <strong className="text-[#0a0a0a]">{r.prediction}</strong> · gold{" "}
                    <strong className="text-[#0a0a0a]">{r.gold}</strong>
                  </span>
                  <span>confidence {(r.confidence * 100).toFixed(1)}%</span>
                  {r.entropyBits !== null && <span>entropy {r.entropyBits} bits</span>}
                </div>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {r.fallbackReady && mode === "live" && !r.fallbackText && (
                    <button
                      type="button"
                      disabled={r.fallbackBusy}
                      onClick={() => generateFallback(r.id)}
                      className="border border-[#0a0a0a] bg-[#ece8df] px-2.5 py-1.5 font-mono text-[11px] font-bold text-[#0a0a0a] hover:bg-[#ffffff] disabled:opacity-50"
                    >
                      {r.fallbackBusy ? "Generating…" : "Generate fallback"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => copyReceipt(r)}
                    className="border border-[#0a0a0a] bg-[#ffffff] px-2.5 py-1.5 font-mono text-[11px] font-bold text-[#0a0a0a] hover:bg-[#ece8df]"
                  >
                    {copiedId === r.id ? "Receipt copied" : "Copy receipt"}
                  </button>
                </div>
                {r.fallbackText && (
                  <div className="mt-2.5 border border-[#0a0a0a] bg-[#ece8df] p-2.5">
                    <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#d97706]">
                      Unverified fallback: no calibrated confidence
                    </div>
                    <p className="mt-1 text-xs text-[#0a0a0a]">{r.fallbackText}</p>
                  </div>
                )}
              </div>
            );
          })}
        </section>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-[11px] text-[#525252]">
            Every counter above is computed from the streamed rows. Reproduce the numbers: pnpm capture{" "}
            {"&&"} pnpm calibrate.
          </p>
          <div className="flex flex-col sm:flex-row w-full sm:w-auto gap-3">
            <Link
              href="/proof"
              style={{ color: "#ffffff", backgroundColor: "#0a0a0a" }}
              className="w-full sm:w-auto border-2 border-[#0a0a0a] bg-[#0a0a0a] !text-white px-4 py-2 font-mono text-xs font-bold shadow-[2px_2px_0_0_#0047ff] hover:-translate-y-0.5 transition-transform text-center"
            >
              <span className="!text-white text-white font-bold" style={{ color: "#ffffff" }}>
                Measured accuracy
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
