"use client";

// components/model-picker.tsx — Shared model picker for the inbox and
// calibrate pages. Presets that failed to load are hidden (never retried
// silently); the custom id field is always labelled EXPERIMENTAL. All sizes
// and statuses arrive via props — this component measures nothing itself.
import type { ModelPreset } from "@/lib/models";

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
}

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
}: ModelPickerProps) {
  const visible = presets.filter((p) => !failedIds.includes(p.id));
  const failed = presets.filter((p) => failedIds.includes(p.id));

  return (
    <div className="flex flex-col gap-2.5 border-2 border-[#0a0a0a] bg-[#ffffff] p-3.5 sm:p-4 shadow-[3px_3px_0_0_#0a0a0a]">
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
      <p className="font-mono text-[11px] text-[#0a0a0a]">
        {sizes[selectedId] ?? "Checking download size…"}
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex flex-1 flex-col gap-1 font-mono text-[11px]">
          <label htmlFor="custom-model-input" className="inline-flex items-center gap-1.5 font-bold uppercase tracking-wider text-[#0a0a0a]">
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
        Any ONNX causal LM the transformers runtime supports. Architecture, size, or memory failures
        surface as a plain error, never a hang.
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
    </div>
  );
}
