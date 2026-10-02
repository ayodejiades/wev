"use client";

import { useState } from "react";

export function CodeDiff({
  title = "Payload Inspection & Sanitization Diff",
  beforeTitle = "Untrusted Client Input",
  afterTitle = "Verified AST Output",
  beforeCode = `// Incoming raw payload
{
  "user_id": "usr_99812",
  "intent": "withdraw",
  "amount_wei": "10000000000000000000",
  "recipient": "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
  "bypass_auth": true // [INJECTION ATTEMPT]
}`,
  afterCode = `// Deterministic sanitized payload
{
  "user_id": "usr_99812",
  "intent": "withdraw",
  "amount_wei": "10000000000000000000",
  "recipient": "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
  "auth_verified": true,
  "signature_r": "0x3f8a...e12a",
  "sanitized_at": 1727134200
}`,
}: {
  title?: string;
  beforeTitle?: string;
  afterTitle?: string;
  beforeCode?: string;
  afterCode?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(afterCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full overflow-hidden rounded-[var(--radius)] border border-[var(--border,#262626)] bg-[var(--bg,#0a0a0a)] shadow-[var(--shadow)] font-mono text-xs">
      {/* Terminal Titlebar */}
      <div className="flex items-center justify-between border-b border-[var(--border,#262626)] bg-[var(--surface,#121212)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
          </div>
          <span className="ml-2 font-medium text-[var(--fg,#ededed)]">{title}</span>
        </div>

        <button
          onClick={handleCopy}
          className="rounded border border-[var(--border,#262626)] bg-[var(--surface-raised,#1f1f1f)] px-2.5 py-1 text-[11px] text-[var(--fg-muted,#888)] hover:text-[var(--fg,#ededed)] transition-colors"
        >
          {copied ? "Copied" : "Copy Output"}
        </button>
      </div>

      {/* Split Code View */}
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[var(--border,#262626)]">
        {/* Left: Before */}
        <div className="flex flex-col bg-red-950/5 p-4">
          <div className="flex items-center justify-between text-[11px] text-red-700 font-semibold mb-2">
            <span>{beforeTitle}</span>
            <span className="rounded bg-red-900/30 px-1.5 py-0.5 border border-red-800/40 text-[10px]">
              RAW / UNCHECKED
            </span>
          </div>
          <pre className="overflow-x-auto text-[var(--fg-muted,#888)] leading-relaxed">
            <code>{beforeCode}</code>
          </pre>
        </div>

        {/* Right: After */}
        <div className="flex flex-col bg-emerald-950/5 p-4">
          <div className="flex items-center justify-between text-[11px] text-emerald-700 font-semibold mb-2">
            <span>{afterTitle}</span>
            <span className="rounded bg-emerald-900/30 px-1.5 py-0.5 border border-emerald-800/40 text-[10px]">
              VERIFIED / SANITIZED
            </span>
          </div>
          <pre className="overflow-x-auto text-emerald-800 leading-relaxed">
            <code>{afterCode}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}
