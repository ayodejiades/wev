/**
 * lib/local-folder.ts — Bring-your-own local model folder (Experimental).
 *
 * A dropped folder (config.json, tokenizer.json, tokenizer_config.json,
 * onnx/model*.onnx) is served to transformers.js through a custom cache
 * (`env.useCustomCache` + `local_files_only`), so `from_pretrained` resolves
 * to the local files with no upload to any server. Pure logic only: no
 * transformers import, no DOM, no window — unit-tested in Node, and the same
 * mapping is exercised against real folders by the session check described in
 * WHAT_IS_REAL.md.
 *
 * Limits, stated plainly: only single-file weights (a sibling .onnx_data
 * means external data this path does not serve); bnb4 is refused (needs
 * bitsandbytes, absent from the browser runtime).
 */

export interface FolderFile {
  /** Repo-relative path with forward slashes, e.g. "onnx/model_uint8.onnx". */
  path: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export class LocalFolderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalFolderError";
  }
}

/** Normalize dropped paths (./ prefixes, backslashes, empty segments). */
export function normalizeFolderPath(raw: string): string {
  return raw
    .replace(/\\/g, "/")
    .split("/")
    .filter((seg) => seg.length > 0 && seg !== ".")
    .join("/");
}

export function buildInventory(files: FolderFile[]): Map<string, FolderFile> {
  const inventory = new Map<string, FolderFile>();
  for (const file of files) {
    const path = normalizeFolderPath(file.path);
    if (!path) continue;
    if (!inventory.has(path)) inventory.set(path, { ...file, path });
  }
  return inventory;
}

const REQUIRED_META = ["config.json", "tokenizer.json", "tokenizer_config.json"];

/** Weight files by preference. Suffixes mirror transformers.js. */
const WEIGHT_PREFERENCE: Array<{ dtype: string; suffix: string }> = [
  { dtype: "uint8", suffix: "_uint8" },
  { dtype: "int8", suffix: "_int8" },
  { dtype: "q4", suffix: "_q4" },
  { dtype: "q4f16", suffix: "_q4f16" },
  { dtype: "fp16", suffix: "_fp16" },
  { dtype: "q8", suffix: "_quantized" },
  { dtype: "fp32", suffix: "" },
];

function isOnnxWeight(path: string): boolean {
  // Dropped folders nest under their root name ("smol/onnx/model_uint8.onnx").
  return /(^|\/)onnx\/model[^/]*\.onnx$/.test(path) || /^model[^/]*\.onnx$/.test(path);
}

function weightFileFor(dtypeSuffix: string, basenames: Set<string>): string | null {
  for (const name of basenames) {
    if (isOnnxWeight(name) && name.endsWith(`${dtypeSuffix}.onnx`)) return name;
  }
  return null;
}

export interface FolderValidation {
  folderFiles: string[];
  weightsFile: string;
  dtype: string;
}

/**
 * Validate a dropped folder. Throws LocalFolderError naming exactly what is
 * missing. Refuses multi-file weights (sibling .onnx_data) and bnb4.
 */
export function validateFolder(inventory: Map<string, FolderFile>): FolderValidation {
  const names = new Set(inventory.keys());
  const missing = REQUIRED_META.filter((f) => ![...names].some((n) => n === f || n.endsWith(`/${f}`)));
  if (missing.length > 0) {
    throw new LocalFolderError(
      `folder is missing ${missing.join(", ")} (drop the model folder itself, not a subfolder)`
    );
  }
  const onnxFiles = [...names].filter(isOnnxWeight);
  if (onnxFiles.some((n) => n.includes("_bnb4"))) {
    throw new LocalFolderError("bnb4 weights need bitsandbytes, absent from the browser runtime");
  }
  for (const { dtype, suffix } of WEIGHT_PREFERENCE) {
    const hit = weightFileFor(suffix, names);
    if (!hit) continue;
    const companion = `${hit.slice(0, -".onnx".length)}.onnx_data`;
    if (names.has(companion)) {
      throw new LocalFolderError(
        `${hit} has a split ${companion} companion; only single-file weights load from a folder`
      );
    }
    return { folderFiles: [...names].sort(), weightsFile: hit, dtype };
  }
  throw new LocalFolderError("no usable onnx/model*.onnx weights found (need uint8, int8, q4, fp16, q8, or single-file fp32)");
}

/** Requested cache key -> repo-relative filename (remote URL tail or plain path). */export function cacheKeyToFilename(key: unknown): string | null {
  if (typeof key !== "string" || key.length === 0) return null;
  const m = key.match(/\/resolve\/[^/]+\/(.+)$/);
  const tail = m ? m[1] : key;
  return normalizeFolderPath(tail.split("?")[0]);
}

/**
 * Custom-cache backend over the inventory: serves dropped bytes, misses
 * everything else (a miss under local_files_only becomes a clear
 * file-not-found error naming the requested file). `put` is a no-op.
 */export function createFolderCache(inventory: Map<string, FolderFile>): {
  match: (key: unknown) => Promise<Response | undefined>;
  put: () => Promise<void>;
} {
  const byBasename = new Map<string, FolderFile>();
  for (const [path, file] of inventory) {
    const base = path.split("/").pop() as string;
    if (!byBasename.has(base)) byBasename.set(base, file);
  }
  return {
    async match(key: unknown): Promise<Response | undefined> {
      const filename = cacheKeyToFilename(key);
      if (!filename) return undefined;
      const direct = inventory.get(filename);
      if (direct) return new Response(await direct.arrayBuffer());
      const base = filename.split("/").pop() as string;
      const fallback = byBasename.get(base);
      if (fallback) return new Response(await fallback.arrayBuffer());
      return undefined;
    },
    async put(): Promise<void> {
      // Folder bytes are already local; nothing to persist.
    },
  };
}

/** Minimal dropped-file shape (DOM File satisfies it). */
export interface DroppedFile {
  name: string;
  size: number;
  webkitRelativePath?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Folder display name: the dropped root, or a fallback when paths are flat. */
export function folderNameFor(files: Array<{ webkitRelativePath?: string; name: string }>): string {
  const first = files.find((f) => f.webkitRelativePath && f.webkitRelativePath.includes("/"));
  if (first?.webkitRelativePath) {
    const root = normalizeFolderPath(first.webkitRelativePath).split("/")[0];
    if (root) return root;
  }
  return "dropped-folder";
}

/** Convert dropped Files to inventory entries (relative path or bare name). */
export function filesToFolderFiles(files: DroppedFile[]): FolderFile[] {
  return files.map((f) => ({
    path: normalizeFolderPath(f.webkitRelativePath || f.name),
    size: f.size,
    arrayBuffer: () => f.arrayBuffer(),
  }));
}
