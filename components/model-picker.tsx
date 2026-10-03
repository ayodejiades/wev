"use client";

// components/model-picker.tsx — Shared model picker for the inbox and
// calibrate pages. Presets that failed to load are hidden (never retried
// silently); the custom id field is always labelled EXPERIMENTAL. The Adapter
// row states exactly what "any local model" means here: the in-browser ONNX
// runtime, a local OpenAI-compatible server that returns token log-probs
// (EXPERIMENTAL), or a pre-scored file (no model at all). All sizes and
// statuses arrive via props — this component measures nothing itself.
import type { ModelPreset } from "@/lib/models";
import { LOCAL_SERVER_DEFAULT_URL } from "@/lib/wev-model";

/** Which family of adapter the page should build. */
export type AdapterKind = "onnx" | "server" | "prescored";

export interface ModelPickerProps {
  presets: ModelPreset[];
  selectedId: string;
  failedIds: string[];
  /** Download size line per model id; missing means still looking up. */
  sizes: Record<string, string>;
  customId: string;
  onCustomIdChange: (id: string) => void;
  onPick: (id: string) => void;
  /** Staged local folder summary, if one is dropped. */
  folderSummary: string | null;
  onPickFolder: (files: File[]) => void;
  /** Current adapter family and its setters (absent renders ONNX only). */
  adapter?: {
    kind: AdapterKind;
    onAdapterChange: (kind: AdapterKind) => void;
    serverUrl: string;
    onServerUrlChange: (url: string) => void;
    serverModel: string;
    onServerModelChange: (model: string) => void;
    prescoredSummary: string | null;
    onPickPrescored: (file: File) => void;
  };
}

const ADAPTER_LABELS: Array<{ kind: AdapterKind; label: string; note: string }> = [
  { kind: "onnx", label: "In-browser ONNX", note: "transformers.js in this tab; weights download once." },
  {
    kind: "server",
    label: "Local server (experimental)",
    note: "OpenAI-compatible /v1/completions that returns token log-probs (llama.cpp server style).",
  },
  {
    kind: "prescored",
    label: "Pre-scored file",
    note: "CSV or JSON of scores from any model; needs no model and no download.",
  },
];

export function ModelPicker({
  presets,
  selectedId,
  failedIds,
  sizes,
  customId,
  onCustomIdChange,
  onPick,
  folderSummary,
  onPickFolder,
  adapter,
}: ModelPickerProps) {
  const visible = presets.filter((p) => !failedIds.includes(p.id));
  const failed = presets.filter((p) => failedIds.includes(p.id));

  return (
    <div className="flex flex-col gap-2.5 border-2 border-[#0a0a0a] bg-[#ffffff] p-3.5 sm:p-4 shadow-[3px_3px_0_0_#0a0a0a]">
      {adapter && (
        <div className="flex flex-col gap-2 border-b border-[#0a0a0a] pb-2.5">
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#0a0a0a]">
            Adapter
          </span>
          <div className="flex flex-wrap gap-2">
            {ADAPTER_LABELS.map((a) => {
              const selected = a.kind === adapter.kind;
              return (
                <button
                  key={a.kind}
                  type="button"
                  data-testid={`adapter-${a.kind}`}
                  onClick={() => adapter.onAdapterChange(a.kind)}
                  title={a.note}
                  style={selected ? { color: "#ffffff", backgroundColor: "#0a0a0a" } : undefined}
                  className={`border-2 px-3 py-2 text-left font-mono transition-transform hover:-translate-y-0.5 cursor-pointer ${
                    selected
                      ? "border-[#0a0a0a] bg-[#0a0a0a] !text-white shadow-[2px_2px_0_0_#0047ff]"
                      : "border-[#0a0a0a] bg-[#ece8df] text-[#0a0a0a]"
                  }`}
                >
                  <span
                    className={`block text-xs font-bold ${selected ? "!text-white text-white" : "text-[#0a0a0a]"}`}
                    style={selected ? { color: "#ffffff" } : undefined}
                  >
                    {a.label}
                  </span>
                  <span
                    className={`block text-[10px] ${selected ? "!text-white/90 text-white/90" : "text-[#525252]"}`}
                    style={selected ? { color: "#ffffff" } : undefined}
                  >
                    {a.kind === "onnx" ? "default" : a.kind === "server" ? "experimental" : "no model"}
                  </span>
                </button>
              );
            })}
          </div>

          {adapter.kind === "server" && (
            <div className="flex flex-col sm:flex-row gap-2 font-mono text-[11px]">
              <div className="flex flex-1 flex-col gap-1">
                <label htmlFor="server-base-url" className="font-bold uppercase tracking-wider text-[#0a0a0a]">
                  Server base URL
                </label>
                <input
                  id="server-base-url"
                  data-testid="server-base-url"
                  type="text"
                  value={adapter.serverUrl}
                  placeholder={LOCAL_SERVER_DEFAULT_URL}
                  onChange={(e) => adapter.onServerUrlChange(e.target.value)}
                  className="border-2 border-[#0a0a0a] bg-[#ece8df] p-2 font-mono text-xs text-[#0a0a0a] focus:bg-[#ffffff] focus:outline-none"
                />
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <label htmlFor="server-model" className="font-bold uppercase tracking-wider text-[#0a0a0a]">
                  Model name
                </label>
                <input
                  id="server-model"
                  data-testid="server-model"
                  type="text"
                  value={adapter.serverModel}
                  placeholder="my-llama-3-8b"
                  onChange={(e) => adapter.onServerModelChange(e.target.value)}
                  className="border-2 border-[#0a0a0a] bg-[#ece8df] p-2 font-mono text-xs text-[#0a0a0a] focus:bg-[#ffffff] focus:outline-none"
                />
              </div>
            </div>
          )}

          {adapter.kind === "prescored" && (
            <div className="flex flex-col gap-1.5 font-mono text-[11px]">
              <label className="cursor-pointer border-2 border-[#0a0a0a] bg-[#ece8df] px-3 py-2 text-center font-bold text-[#0a0a0a] shadow-[2px_2px_0_0_#0a0a0a] hover:bg-[#ffffff]">
                Choose pre-scored file (.csv, .json)
                <input
                  data-testid="prescored-file"
                  type="file"
                  accept=".csv,.json,text/csv,application/json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) adapter.onPickPrescored(file);
                    e.target.value = "";
                  }}
                />
              </label>
              {adapter.prescoredSummary && (
                <p className="text-[#0a0a0a]" data-testid="prescored-summary">
                  {adapter.prescoredSummary}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {adapter?.kind !== "server" && adapter?.kind !== "prescored" && (
        <>
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#525252]">
            Model (thresholds are per model id, never shared across models)
          </span>
          <div className="flex flex-wrap gap-2">
            {visible.map((p) => {
              const selected = p.id === selectedId;
              return (
                <button
                  key={p.id}
                  type="button"
                  data-testid={
                    p.id.includes("135M") ? "model-preset-135m" : p.id.includes("360M") ? "model-preset-360m" : undefined
                  }
                  onClick={() => onPick(p.id)}
                  title={p.note}
                  style={selected ? { color: "#ffffff", backgroundColor: "#0a0a0a" } : undefined}
                  className={`border-2 px-3 py-2 text-left font-mono transition-transform hover:-translate-y-0.5 cursor-pointer ${
                    selected
                      ? "border-[#0a0a0a] bg-[#0a0a0a] !text-white shadow-[2px_2px_0_0_#0047ff]"
                      : "border-[#0a0a0a] bg-[#ece8df] text-[#0a0a0a]"
                  }`}
                >
                  <span
                    className={`block text-xs font-bold ${selected ? "!text-white text-white" : "text-[#0a0a0a]"}`}
                    style={selected ? { color: "#ffffff" } : undefined}
                  >
                    {p.short}
                  </span>
                  <span
                    className={`block text-[10px] ${selected ? "!text-white/90 text-white/90" : "text-[#525252]"}`}
                    style={selected ? { color: "#ffffff" } : undefined}
                  >
                    {p.dtype} &middot; {p.status === "verified" ? "verified" : "weights checked"}
                  </span>
                </button>
              );
            })}
          </div>
          {failed.map((p) => (
            <p key={p.id} className="font-mono text-[11px] text-[#d97706]">
              {p.short} removed: it failed to load and is not listed again this session.
            </p>
          ))}
          <p className="font-mono text-[11px] text-[#0a0a0a]">{sizes[selectedId] ?? "Checking download size…"}</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex flex-1 flex-col gap-1 font-mono text-[11px]">
              <label
                htmlFor="custom-model-input"
                className="inline-flex items-center gap-1.5 font-bold uppercase tracking-wider text-[#0a0a0a]"
              >
                Custom Hugging Face model id
                <span className="border border-[#d97706] px-1 py-px text-[10px] text-[#d97706]">Experimental</span>
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  id="custom-model-input"
                  type="text"
                  value={customId}
                  onChange={(e) => onCustomIdChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && customId.trim()) {
                      onPick(customId.trim());
                    }
                  }}
                  placeholder="owner/model-ONNX"
                  className="flex-1 border-2 border-[#0a0a0a] bg-[#ece8df] p-2 font-mono text-xs text-[#0a0a0a] focus:bg-[#ffffff] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => onPick(customId.trim())}
                  disabled={!customId.trim()}
                  className="w-full sm:w-auto shrink-0 border-2 border-[#0a0a0a] bg-[#ffffff] px-4 py-2 font-mono text-xs font-bold text-[#0a0a0a] shadow-[2px_2px_0_0_#0a0a0a] hover:-translate-y-0.5 transition-transform disabled:opacity-50 disabled:pointer-events-none cursor-pointer text-center"
                >
                  Use
                </button>
              </div>
            </div>
          </div>
          <p className="font-mono text-[10px] text-[#525252]">
            In-browser ONNX only: any causal LM with ONNX weights the transformers runtime supports, a preset,
            a custom id, or a dropped model folder. Architecture, size, or memory failures surface as a plain
            error, never a hang. Local servers and pre-scored files are the two other adapters above.
          </p>
          <div className="flex flex-col gap-2 border-t border-[#0a0a0a] pt-2.5">
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-[#0a0a0a]">
              Local model folder
              <span className="border border-[#d97706] px-1 py-px text-[10px] text-[#d97706]">Experimental</span>
            </span>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const files = Array.from(e.dataTransfer.files ?? []);
                if (files.length > 0) onPickFolder(files);
              }}
              className="border border-dashed border-[#0a0a0a] bg-[#ece8df] p-2.5 text-center font-mono text-[11px] text-[#0a0a0a]"
            >
              Drop a model folder here, or{" "}
              <label className="cursor-pointer font-bold underline">
                choose it
                <input
                  ref={(el) => {
                    el?.setAttribute("webkitdirectory", "");
                  }}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length > 0) onPickFolder(files);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            <p className="font-mono text-[10px] text-[#525252]">
              Needs config.json, tokenizer files and single-file onnx weights. Nothing uploads anywhere.
            </p>
            {folderSummary && <p className="font-mono text-[11px] text-[#0a0a0a]">{folderSummary}</p>}
          </div>
        </>
      )}
    </div>
  );
}
