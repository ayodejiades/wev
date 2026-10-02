import type { ReactNode } from "react";

export function Sidebar({ children }: { children: ReactNode }) {
  return (
    <aside className="hidden w-56 shrink-0 flex-col gap-1 border-r border-[var(--border)] p-4 sm:flex">
      {children}
    </aside>
  );
}
