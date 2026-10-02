import Link from "next/link";

export function Nav({ project }: { project: string }) {
  return (
    <nav className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
      <Link href="/" className="font-semibold text-[var(--fg)]">
        {project}
      </Link>
      <div className="flex items-center gap-4 text-sm text-[var(--fg-muted)]">
        <Link href="/" className="hover:text-[var(--fg)]">
          Dashboard
        </Link>
      </div>
    </nav>
  );
}
