// app/not-found.tsx — a dead link should still look like the product.
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[var(--bg)] px-6 text-center text-[var(--fg)]">
      <div className="max-w-md space-y-3">
        <p className="font-mono text-xs uppercase tracking-widest text-[var(--fg-muted)]">
          404
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">No such page</h1>
        <p className="text-sm text-[var(--fg-muted)]">
          The address you followed does not exist on this deployment.
        </p>
      </div>
      <Link
        href="/"
        style={{ color: "#ffffff", backgroundColor: "#0a0a0a" }}
        className="border-2 border-[#0a0a0a] bg-[#0a0a0a] !text-white px-5 py-2.5 font-mono text-xs font-bold shadow-[2px_2px_0_0_#0047ff] hover:-translate-y-0.5 transition-transform cursor-pointer text-center"
      >
        <span className="!text-white text-white font-bold" style={{ color: "#ffffff" }}>
          Go to the overview
        </span>
      </Link>
      <footer className="text-xs text-[var(--fg-muted)]">
        <p>© {new Date().getFullYear()} WEV. All rights reserved.</p>
      </footer>
    </main>
  );
}