"use client";

// app/calibrate/page.tsx — "Calibrate your own". Paste or drop ~30 labelled
// items (CSV or JSON: text,label); the in-browser SmolLM2 model scores them
// with the same closed-label scoring as `pnpm capture`, and the same seeded
// split logic as `pnpm calibrate` (both shared from lib/) derives thresholds
// and reports accuracy at coverage versus always trusting the model.
// Fewer than 20 items are refused with the reason why.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import { ModelPicker, type AdapterKind } from "@/components/model-picker";
import {
  TRIAGE_DECIDER,
  decide,
  parseLabelledItemsCsv,
  parseLabelledItemsJson,
  type LabelledItem,
} from "@/lib/decider";
import {
  LOCAL_SERVER_DEFAULT_URL,
  createAdapterFromChoice,
  loadTriageAdapter,
  loadTriageAdapterFromFolder,
  parsePrescoredFile,
} from "@/lib/wev-model";
import { folderNameFor } from "@/lib/local-folder";
import {
  MODEL_PRESETS,
  explainLoadError,
  fetchModelSize,
  saveThresholdsForModel,
} from "@/lib/models";
import {
  CALIBRATION_SEED,
  MIN_CALIBRATION_ITEMS,
  gateReport,
  pickThresholds,
  seededSplit,
} from "@/lib/calibrate";
import { buildGateCard, buildGateCopyText, selectGateTestCases } from "@/lib/gate-export";
import { evidenceFromManifest } from "@/lib/receipt";
import { copyText } from "@/lib/clipboard";
import itemsData from "../../data/items.json";

interface UserRow {
  id: string;
  text: string;
  gold: string;
  probabilities: Record<string, number>;
  prediction: string;
  confidence: number;
  entropyBits: number;
  correct: boolean;
  auto: boolean;
}

type Phase = "idle" | "ready" | "loading" | "scoring" | "done" | "error";

const EXAMPLE_CSV = `text,label
"I was charged twice for $18, please give it back",refund
"Where is my order? Tracking says delivered",review
"MAKE MONEY FAST click here bit.ly/xyz win prize now",reject`;

const SAMPLE_30_CSV = [
  "text,label",
  ...((itemsData as { items: Array<{ text: string; gold: string }> }).items.slice(0, 30).map(
    (i) => `"${i.text.replace(/"/g, '""')}",${i.gold}`
  )),
].join("\n");

/** The committed evidence digests, or null when the manifest is unusable. */
function safeEvidence() {
  try {
    return evidenceFromManifest();
  } catch {
    return null;
  }
}

function detectFormat(raw: string): "json" | "csv" {
  return raw.trimStart().startsWith("[") ? "json" : "csv";
}

export default function CalibratePage() {
  const [text, setText] = useState("");
  const [items, setItems] = useState<LabelledItem[] | null>(null);
  const [parseError, setParseError] = useState("");
  const [fileName, setFileName] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [rows, setRows] = useState<UserRow[]>([]);
  const [thresholds, setThresholds] = useState<{ autoConfidence: number; maxEntropyBits: number } | null>(null);
  const [heldReport, setHeldReport] = useState<ReturnType<typeof gateReport> | null>(null);
  const [calibReport, setCalibReport] = useState<ReturnType<typeof gateReport> | null>(null);
  const [error, setError] = useState("");
  const [exportNote, setExportNote] = useState("");
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
  const [isDragging, setIsDragging] = useState(false);
  const cancelRef = useRef(false);

  useEffect(() => {
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

  const presetOf = (id: string) => MODEL_PRESETS.find((p) => p.id === id);

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

  /** Model id the thresholds are keyed on: never shared across adapters. */
  const activeModelId =
    adapterKind === "server"
      ? `server:${serverModel.trim() || "unnamed-server"}`
      : adapterKind === "prescored"
      ? `prescored:${prescored?.fileName ?? "no-file"}`
      : modelId;
  const activeShort =
    adapterKind === "onnx" ? (presetOf(modelId)?.short ?? modelId) : activeModelId;

  function changeAdapter(kind: AdapterKind) {
    setAdapterKind(kind);
    setError("");
    if (kind === "prescored" && !prescored) {
      setPrescoredSummary("No pre-scored file chosen yet: pick a .csv or .json above.");
    }
    if (kind !== "prescored") setPrescoredSummary(null);
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
      setPrescoredSummary("");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function checkItems() {
    setParseError("");
    setItems(null);
    setRows([]);
    setThresholds(null);
    setHeldReport(null);
    setCalibReport(null);
    setExportNote("");
    setPhase("idle");
    try {
      const parsed =
        detectFormat(text) === "json"
          ? parseLabelledItemsJson(text, [...TRIAGE_DECIDER.labels])
          : parseLabelledItemsCsv(text, [...TRIAGE_DECIDER.labels]);
      setItems(parsed);
      setPhase("ready");
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
    }
  }

  async function readFile(file: File) {
    setFileName(file.name);
    setText(await file.text());
    setItems(null);
    setPhase("idle");
  }

  async function run() {
    if (!items || items.length < MIN_CALIBRATION_ITEMS) return;
    cancelRef.current = false;
    setRows([]);
    setError("");
    setExportNote("");
    setPhase("loading");
    try {
      let adapter;
      try {
        if (adapterKind === "server") {
          if (!serverModel.trim()) {
            throw new Error("Name the model your local server serves, then run again.");
          }
          adapter = createAdapterFromChoice(
            { kind: "server", baseUrl: serverUrl.trim() || LOCAL_SERVER_DEFAULT_URL, model: serverModel.trim() },
            TRIAGE_DECIDER
          );
        } else if (adapterKind === "prescored") {
          if (!prescored) {
            throw new Error("Choose a pre-scored .csv or .json file first: it supplies the scores.");
          }
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
            { modelId, dtype: presetOf(modelId)?.dtype ?? "uint8" }
          );
        }
      } catch (e) {
        if (adapterKind !== "onnx") throw e; // adapter errors are shown verbatim
        if (presetOf(modelId)) setFailedIds((f) => (f.includes(modelId) ? f : [...f, modelId]));
        throw new Error(explainLoadError(e));
      }
      setPhase("scoring");
      const scored: UserRow[] = [];
      for (let i = 0; i < items.length; i++) {
        if (cancelRef.current) break;
        const item = items[i];
        const out = await decide(adapter, TRIAGE_DECIDER, item.text);
        if (out.entropyBits === null) throw new Error("model returned no full-vocabulary entropy");
        scored.push({
          id: `u-${i}`,
          text: item.text,
          gold: item.gold,
          probabilities: out.probabilities,
          prediction: out.value,
          confidence: out.confidence,
          entropyBits: out.entropyBits,
          correct: out.value === item.gold,
          auto: false,
        });
        setRows([...scored]);
      }
      if (cancelRef.current) {
        setPhase("ready");
        return;
      }
      const { calibration, heldout } = seededSplit(scored, CALIBRATION_SEED);
      const picked = pickThresholds(calibration);
      if (!picked) throw new Error("nothing auto-handles at any threshold; the gate stays fully escalated");
      const withVerdicts = scored.map((r) => ({
        ...r,
        auto: r.confidence >= picked.autoConfidence && r.entropyBits <= picked.maxEntropyBits,
      }));
      setRows(withVerdicts);
      setThresholds(picked);
      saveThresholdsForModel(activeModelId, picked, {
        calibratedAt: new Date().toISOString(),
        items: withVerdicts.length,
      });
      setExportNote(`Thresholds saved on this device for ${activeShort} (${withVerdicts.length} items).`);
      setCalibReport(gateReport(withVerdicts.filter((r) => calibration.some((c) => c.id === r.id)), picked));
      setHeldReport(gateReport(withVerdicts.filter((r) => heldout.some((h) => h.id === r.id)), picked));
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  async function copyGateOwn() {
    if (!thresholds || rows.length === 0) return;
    try {
      const cases = selectGateTestCases(rows, thresholds);
      const src = buildGateCopyText({
        modelId: activeModelId,
        decider: `${TRIAGE_DECIDER.name}@${TRIAGE_DECIDER.version}`,
        thresholds,
        cases,
      });
      const ok = await copyText(src);
      setExportNote(
        ok
          ? `Copied ${src.split("\n").length} lines: triageGate() with your thresholds plus ${cases.length} test cases from your items.`
          : "Copy failed: the browser blocked clipboard access."
      );
    } catch (e) {
      setExportNote(`Copy gate failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function downloadGateCardOwn() {
    if (!thresholds || !heldReport || !calibReport || rows.length === 0) return;
    try {
      const card = buildGateCard({
        modelId: activeModelId,
        dtype: adapterKind === "onnx" ? (presetOf(modelId)?.dtype ?? "uint8") : "n/a",
        decider: `${TRIAGE_DECIDER.name}@${TRIAGE_DECIDER.version}`,
        thresholds,
        seed: CALIBRATION_SEED,
        calibrationSize: calibReport.total,
        heldoutSize: heldReport.total,
        heldout: {
          coverage: heldReport.coverage,
          accuracyAtCoverage: heldReport.accuracyAtCoverage,
          baselineAccuracy: heldReport.baselineAccuracy,
          wrongAutoActions: heldReport.wrongAutoActions,
          autoHandled: heldReport.autoHandled,
          total: heldReport.total,
        },
        calibratedAt: new Date().toISOString(),
        syntheticDataNote: "User-supplied labels scored on-device just now; not independently verified.",
        labelCount: TRIAGE_DECIDER.labels.length,
        totalItems: rows.length,
        // The committed evidence run, named in the card. Null when it is absent.
        evidence: safeEvidence(),
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
      setExportNote(`Downloaded gate-card.json for your ${rows.length} items.`);
    } catch (e) {
      setExportNote(`Download card failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const tooFew = items !== null && items.length < MIN_CALIBRATION_ITEMS;
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const running = phase === "loading" || phase === "scoring";

  return (
    <DashboardShell project="WEV">
      <div className="flex flex-col gap-6 py-2">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-[#0a0a0a] pb-4 sm:pb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="shrink-0 border border-[#0a0a0a] bg-[#0a0a0a] px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider text-white">
                GATE.CALIBRATE
              </span>
              <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-[#0a0a0a]">
                Calibrate your own
              </h1>
            </div>
            <p className="mt-1 max-w-2xl text-xs text-[#525252]">
              Paste or drop ~30 labelled tickets (CSV or JSON: text,label). The on-device model scores them
              with the same closed-label scoring as capture; the same seeded split derives your thresholds.
            </p>
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

        {/* Input panel */}
        <section
          className={`flex flex-col gap-3 border-2 ${
            isDragging ? "border-[#0047ff] bg-[#0047ff]/5" : "border-[#0a0a0a] bg-[#ffffff]"
          } p-3.5 sm:p-5 shadow-[4px_4px_0_0_#0a0a0a] transition-colors`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setIsDragging(false);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void readFile(file);
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#525252]">
              Your labelled items · labels must be {TRIAGE_DECIDER.labels.join(" / ")}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <label className="cursor-pointer border-2 border-[#0a0a0a] bg-[#ffffff] px-2.5 py-1.5 font-mono text-[11px] font-bold text-[#0a0a0a] shadow-[2px_2px_0_0_#0a0a0a] hover:bg-[#ece8df] hover:-translate-y-0.5 transition-transform">
                Choose file{fileName ? `: ${fileName}` : ""}
                <input
                  type="file"
                  accept=".csv,.json,text/csv,application/json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void readFile(file);
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  setText(EXAMPLE_CSV);
                  setFileName("");
                  setItems(null);
                  setPhase("idle");
                  setParseError("");
                }}
                className="border-2 border-[#0a0a0a] bg-[#ffffff] px-2.5 py-1.5 font-mono text-[11px] font-bold text-[#0a0a0a] shadow-[2px_2px_0_0_#0a0a0a] hover:bg-[#ece8df] hover:-translate-y-0.5 transition-transform cursor-pointer"
              >
                Load 3-row example
              </button>
              <button
                type="button"
                onClick={() => {
                  setText(SAMPLE_30_CSV);
                  setFileName("");
                  setItems(null);
                  setPhase("idle");
                  setParseError("");
                }}
                style={{ color: "#ffffff", backgroundColor: "#0a0a0a" }}
                className="border-2 border-[#0a0a0a] bg-[#0a0a0a] !text-white px-2.5 py-1.5 font-mono text-[11px] font-bold shadow-[2px_2px_0_0_#0047ff] hover:-translate-y-0.5 transition-transform cursor-pointer"
              >
                <span className="!text-white text-white font-bold" style={{ color: "#ffffff" }}>
                  Load 30 sample items
                </span>
              </button>
            </div>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void readFile(file);
            }}
            rows={8}
            placeholder={'text,label\n"charged twice, refund please",refund\n"where is my parcel",review'}
            className="w-full border-2 border-[#0a0a0a] bg-[#ece8df] p-2.5 sm:p-3 font-mono text-xs leading-relaxed text-[#0a0a0a] focus:bg-[#ffffff] focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={checkItems}
              style={{ color: "#ffffff", backgroundColor: "#0a0a0a" }}
              className="w-full sm:w-auto text-center border-2 border-[#0a0a0a] bg-[#0a0a0a] !text-white px-4 py-2 font-mono text-xs font-bold shadow-[2px_2px_0_0_#0047ff] hover:-translate-y-0.5 transition-transform cursor-pointer"
            >
              <span className="!text-white text-white font-bold" style={{ color: "#ffffff" }}>
                Check items
              </span>
            </button>
            {items && (
              <span className="font-mono text-[11px] text-[#0a0a0a]">
                Found {items.length} labelled items.
              </span>
            )}
            {parseError && <span className="font-mono text-[11px] font-bold text-[#dc2626]">{parseError}</span>}
          </div>
          {tooFew && (
            <div className="border-2 border-[#dc2626] bg-[#dc2626]/10 p-3 font-mono text-xs text-[#dc2626]">
              Found {items.length} labelled items: need at least {MIN_CALIBRATION_ITEMS}. Thresholds are
              picked on one half and reported on the other; with fewer than {MIN_CALIBRATION_ITEMS} items
              each half drops below 10 and the picked bar overfits noise instead of measuring the model.
              Add more rows and check again.
            </div>
          )}
        </section>

        {items && !tooFew && phase !== "done" && phase !== "error" && (
          <div className="flex flex-wrap gap-2">
            {!running ? (
              <button
                type="button"
                data-demo="calibrate-run"
                data-testid="run-button"
                onClick={run}
                style={{ color: "#ffffff", backgroundColor: "#0a0a0a" }}
                className="w-full sm:w-auto text-center border-2 border-[#0a0a0a] bg-[#0a0a0a] !text-white px-5 py-2.5 font-mono text-xs font-bold shadow-[2px_2px_0_0_#0047ff] hover:-translate-y-0.5 transition-transform cursor-pointer"
              >
                <span className="!text-white text-white font-bold" style={{ color: "#ffffff" }}>
                  {adapterKind === "onnx"
                    ? `Score ${items.length} items on-device`
                    : adapterKind === "server"
                    ? `Score ${items.length} items via the local server`
                    : `Replay ${items.length} pre-scored rows`}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  cancelRef.current = true;
                }}
                className="w-full sm:w-auto text-center border-2 border-[#0a0a0a] bg-[#ffffff] px-5 py-2.5 font-mono text-xs font-bold text-[#0a0a0a] shadow-[2px_2px_0_0_#0a0a0a]"
              >
                Stop
              </button>
            )}
          </div>
        )}

        {running && (
          <div className="flex flex-col gap-1.5 border-2 border-[#0a0a0a] bg-[#ffffff] p-3.5 shadow-[4px_4px_0_0_#0a0a0a]">
            <div className="h-3 overflow-hidden border-2 border-[#0a0a0a] bg-[#ece8df]">
              {phase === "loading" ? (
                <div className="h-full bg-[#0047ff] transition-all" style={{ width: `${progress}%` }} />
              ) : (
                <div
                  className="h-full bg-[#0a0a0a] transition-all"
                  style={{ width: `${items ? Math.round((rows.length / items.length) * 100) : 0}%` }}
                />
              )}
            </div>
            <span data-testid="status-line" className="font-mono text-[11px] text-[#525252]">
              {phase === "loading"
                ? `Loading model ${progress}% · ${progressLabel}`
                : `Item ${rows.length} / ${items?.length ?? 0} · scoring on device`}
            </span>
          </div>
        )}

        {phase === "error" && (
          <p className="border-2 border-[#dc2626] bg-[#dc2626]/10 p-3 font-mono text-xs text-[#dc2626]">{error}</p>
        )}

        {/* Results */}
        {phase === "done" && thresholds && heldReport && calibReport && (
          <>
            <section className="grid grid-cols-2 gap-2 sm:gap-3 sm:grid-cols-4">
              <div
                data-testid="thresholds-block"
                className="border-2 border-[#0a0a0a] bg-[#ffffff] p-2.5 sm:p-4 shadow-[3px_3px_0_0_#0a0a0a]"
              >
                <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#0a0a0a]">
                  Your thresholds
                </div>
                <div className="mt-1 font-mono text-xl sm:text-2xl font-bold text-[#0a0a0a]">
                  ≥ {thresholds.autoConfidence}
                </div>
                <div className="mt-0.5 sm:mt-1 font-mono text-[10px] sm:text-[11px] text-[#525252]">
                  confidence · entropy ≤ {thresholds.maxEntropyBits} bits
                </div>
              </div>
              <div className="border-2 border-[#0a0a0a] bg-[#ffffff] p-2.5 sm:p-4 shadow-[3px_3px_0_0_#0a0a0a]">
                <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#16a34a]">
                  Accuracy at coverage
                </div>
                <div className="mt-1 font-mono text-xl sm:text-2xl font-bold text-[#16a34a]">
                  {pct(heldReport.accuracyAtCoverage)}
                </div>
                <div className="mt-0.5 sm:mt-1 font-mono text-[10px] sm:text-[11px] text-[#525252]">
                  {heldReport.autoHandled} of {heldReport.total} auto (held-out)
                </div>
              </div>
              <div className="border-2 border-[#0a0a0a] bg-[#ffffff] p-2.5 sm:p-4 shadow-[3px_3px_0_0_#0a0a0a]">
                <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#525252]">
                  Always-trust baseline
                </div>
                <div className="mt-1 font-mono text-xl sm:text-2xl font-bold text-[#525252]">
                  {pct(heldReport.baselineAccuracy)}
                </div>
                <div className="mt-0.5 sm:mt-1 font-mono text-[10px] sm:text-[11px] text-[#525252]">
                  {heldReport.baselineWrong} would-be mistakes
                </div>
              </div>
              <div className="border-2 border-[#0a0a0a] bg-[#ffffff] p-2.5 sm:p-4 shadow-[3px_3px_0_0_#0a0a0a]">
                <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#dc2626]">
                  Wrong auto-actions
                </div>
                <div className="mt-1 font-mono text-xl sm:text-2xl font-bold text-[#dc2626]">
                  {heldReport.wrongAutoActions}
                </div>
                <div className="mt-0.5 sm:mt-1 font-mono text-[10px] sm:text-[11px] text-[#525252]">
                  {heldReport.escalated} escalated
                </div>
              </div>
            </section>

            <section className="flex flex-col gap-3 border-2 border-[#0a0a0a] bg-[#ffffff] p-3.5 sm:p-5 shadow-[4px_4px_0_0_#0a0a0a]">
              <div>
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#525252]">
                  Export your gate
                </span>
                <h2 className="font-mono text-lg font-bold text-[#0a0a0a]">Take it with you</h2>
                <p className="mt-1 text-xs text-[#525252]">
                  Computed from your {rows.length} items just now (seed {CALIBRATION_SEED} split). Your labels
                  never leave this browser.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={copyGateOwn}
                  style={{ color: "#ffffff", backgroundColor: "#0a0a0a" }}
                  className="w-full sm:w-auto text-center border-2 border-[#0a0a0a] bg-[#0a0a0a] !text-white px-4 py-2 font-mono text-xs font-bold shadow-[2px_2px_0_0_#0047ff] hover:-translate-y-0.5 transition-transform cursor-pointer"
                >
                  <span className="!text-white text-white font-bold" style={{ color: "#ffffff" }}>
                    Copy gate
                  </span>
                </button>
                <button
                  type="button"
                  onClick={downloadGateCardOwn}
                  className="w-full sm:w-auto text-center border-2 border-[#0a0a0a] bg-[#ffffff] px-4 py-2 font-mono text-xs font-bold text-[#0a0a0a] shadow-[2px_2px_0_0_#0a0a0a] hover:-translate-y-0.5 transition-transform cursor-pointer"
                >
                  Download gate card
                </button>
              </div>
              {exportNote && <p className="font-mono text-[11px] text-[#0a0a0a]">{exportNote}</p>}
            </section>

            <section className="flex flex-col gap-2.5 sm:gap-3">
              {rows.map((r) => (
                <div
                  key={r.id}
                  data-testid="results-row"
                  className={`border-2 bg-[#ffffff] p-3.5 sm:p-4 shadow-[3px_3px_0_0_#0a0a0a] ${
                    r.auto && !r.correct ? "border-[#dc2626]" : "border-[#0a0a0a]"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
                    <span className="font-bold text-[#0a0a0a]">{r.id}</span>
                    <span
                      className={`border px-1.5 py-0.5 font-bold uppercase ${
                        r.auto ? "border-[#16a34a] text-[#16a34a]" : "border-[#d97706] text-[#d97706]"
                      }`}
                    >
                      {r.auto ? "Auto-handled" : "Escalated"}
                    </span>
                  </div>
                  <p className="mt-2 text-xs font-semibold text-[#0a0a0a]">&ldquo;{r.text}&rdquo;</p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-[#525252]">
                    <span>
                      predicted <strong className="text-[#0a0a0a]">{r.prediction}</strong> · gold{" "}
                      <strong className="text-[#0a0a0a]">{r.gold}</strong>
                    </span>
                    <span>confidence {(r.confidence * 100).toFixed(1)}%</span>
                    <span>entropy {r.entropyBits} bits</span>
                  </div>
                </div>
              ))}
            </section>
          </>
        )}

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-[11px] text-[#525252]">
            Same scoring as capture, same split as calibrate: everything above is computed from your items.
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
              href="/inbox"
              className="w-full sm:w-auto text-center border-2 border-[#0a0a0a] bg-[#ffffff] px-4 py-2 font-mono text-xs font-semibold text-[#0a0a0a] shadow-[2px_2px_0_0_#0a0a0a]"
            >
              Inbox
            </Link>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
