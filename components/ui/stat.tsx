export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <span className="text-xs uppercase tracking-wide text-[var(--fg-muted)]">{label}</span>
      <span className="text-2xl font-semibold text-[var(--fg)]">{value}</span>
      {hint ? <span className="text-xs text-[var(--fg-muted)]">{hint}</span> : null}
    </div>
  );
}
