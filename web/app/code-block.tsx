"use client";

import { useState } from "react";

export function CodeBlock({ code, lang, title }: { code: string; lang: string; title?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="overflow-hidden rounded-2xl border-2 border-amber-900/20 bg-[#1f1608] shadow-lg">
      <div className="flex items-center justify-between border-b border-amber-100/10 px-4 py-2">
        <span className="font-mono text-xs text-amber-300/80">{title ?? lang}</span>
        <button
          onClick={() => {
            navigator.clipboard?.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="rounded-md bg-amber-100/10 px-2.5 py-1 text-xs font-semibold text-amber-200 hover:bg-amber-100/20"
        >
          {copied ? "copied ✓" : "copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed text-amber-50">
        <code>{code}</code>
      </pre>
    </div>
  );
}
