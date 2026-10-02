import type { ReactNode } from "react";
import { Illustration } from "./illustration";

export function EmptyState({
  illustration = "no-data",
  title,
  description,
  action,
}: {
  illustration?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-[var(--radius)] border border-dashed border-[var(--border)] p-10 text-center">
      <Illustration id={illustration} className="h-28 w-28" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-[var(--fg)]">{title}</p>
        {description ? <p className="text-sm text-[var(--fg-muted)]">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
