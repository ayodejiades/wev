import { type ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  withArrow?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary: "bg-[var(--accent)] text-[var(--accent-contrast)] hover:brightness-105",
  secondary:
    "bg-[var(--surface-raised)] text-[var(--fg)] border border-[var(--border)] hover:bg-[var(--surface)]",
  ghost: "bg-transparent text-[var(--fg)] hover:bg-[var(--surface)]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", className = "", children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`group inline-flex items-center justify-center font-semibold transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:cursor-not-allowed disabled:opacity-50 rounded-[var(--radius-sm)] px-3 py-2 text-sm sm:text-base gap-2 ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      <span>{children}</span>
    </button>
  );
});
