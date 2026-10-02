"use client";

import { useEffect, useState } from "react";

export function Toast({ message, durationMs = 3000 }: { message: string; durationMs?: number }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setVisible(false), durationMs);
    return () => clearTimeout(t);
  }, [durationMs]);
  if (!visible) return null;
  return (
    <div
      role="status"
      className="fixed bottom-6 right-6 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-2 text-sm text-[var(--fg)] shadow-[var(--shadow)]"
    >
      {message}
    </div>
  );
}
