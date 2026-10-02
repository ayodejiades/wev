import type { HTMLAttributes } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  doubleBezel?: boolean;
}

export function Card({ className = "", doubleBezel = true, children, ...props }: CardProps) {
  if (doubleBezel) {
    return (
      <div className="rounded-[1.5rem] border border-[var(--border,#262626)] bg-[var(--border,#262626)]/40 p-1.5 shadow-sm backdrop-blur-sm">
        <div
          className={`rounded-[calc(1.5rem-0.375rem)] border border-[var(--border,#262626)]/60 bg-[var(--surface,#121212)] p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] ${className}`}
          {...props}
        >
          {children}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-[var(--radius,12px)] border border-[var(--border,#262626)] bg-[var(--surface,#121212)] p-6 shadow-[var(--shadow)] ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
