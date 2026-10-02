// app/loading.tsx — route-level loading state, so navigation never flashes a blank page.
export default function Loading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-6 text-[var(--fg)]">
      <div className="flex flex-col items-center gap-3">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]" />
        <p className="text-sm text-[var(--fg-muted)]">Loading…</p>
      </div>
    </main>
  );
}