import fs from "node:fs";
import path from "node:path";

// Renders an inline SVG from public/illustrations/<id>.svg (put there by apply-theme.py /
// add-illustration.py, with the dominant accent already rewritten to var(--accent)), so the
// art always matches the theme without opening an editor.
export function Illustration({ id, className = "" }: { id: string; className?: string }) {
  const file = path.join(process.cwd(), "public", "illustrations", `${id}.svg`);
  let markup: string;
  try {
    markup = fs.readFileSync(file, "utf-8").replace(/<\?xml[^>]*\?>\s*/, "");
  } catch {
    markup = FALLBACK_SVG;
  }
  return (
    <span
      className={`inline-block text-[var(--accent)] ${className}`}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

const FALLBACK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">' +
  '<circle cx="100" cy="100" r="90" fill="currentColor" opacity="0.15"/>' +
  '<circle cx="100" cy="100" r="50" fill="currentColor" opacity="0.35"/>' +
  "</svg>";
