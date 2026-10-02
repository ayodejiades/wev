export function TelemetryTile({
  label,
  value,
  sparkline = [14, 18, 16, 22, 20, 26, 24, 32, 29, 38],
  delta = "+4.8%",
  status = "live",
  unit = "",
}: {
  label: string;
  value: string;
  sparkline?: number[];
  delta?: string;
  status?: "live" | "nominal" | "warning";
  unit?: string;
}) {
  const min = Math.min(...sparkline);
  const max = Math.max(...sparkline);
  const range = max - min || 1;
  const width = 120;
  const height = 32;

  // Build SVG polyline points
  const points = sparkline
    .map((val, index) => {
      const x = (index / (sparkline.length - 1)) * width;
      const y = height - ((val - min) / range) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[var(--border,#262626)] bg-[var(--surface,#121212)] p-4 shadow-sm">
      <div className="flex items-center justify-between text-xs font-mono text-[var(--fg-muted,#888)]">
        <span className="uppercase tracking-wider">{label}</span>
        <div className="flex items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              status === "live"
                ? "bg-emerald-400 animate-pulse"
                : status === "warning"
                ? "bg-amber-400"
                : "bg-blue-400"
            }`}
          />
          <span className="text-[10px] uppercase font-mono">{status}</span>
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-4">
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-semibold tracking-tight font-mono text-[var(--fg,#ededed)]">
            {value}
          </span>
          {unit && (
            <span className="text-xs font-mono text-[var(--fg-muted,#888)]">{unit}</span>
          )}
        </div>

        {/* Inline SVG Sparkline */}
        <div className="shrink-0">
          <svg width={width} height={height} className="overflow-visible">
            <polyline
              fill="none"
              stroke="var(--accent,#0047FF)"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={points}
            />
          </svg>
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] font-mono text-[var(--fg-muted,#888)] pt-1 border-t border-[var(--border,#262626)]">
        <span className="text-emerald-700">{delta}</span>
        <span>rolling window</span>
      </div>
    </div>
  );
}
