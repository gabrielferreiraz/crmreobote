"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CodeBlock({ children, lang }: { children: string; lang?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard indisponível (http sem TLS, permissão negada) — sem fallback, não é crítico
    }
  }

  return (
    <div className="group relative">
      {lang && (
        <span className="absolute top-2.5 left-3.5 text-[10px] font-medium tracking-wide text-neutral-400 uppercase select-none dark:text-neutral-600">
          {lang}
        </span>
      )}
      <button
        type="button"
        onClick={handleCopy}
        aria-label="Copiar código"
        className="absolute top-2 right-2 flex items-center gap-1 rounded-md border border-neutral-200 bg-white/90 px-2 py-1 text-[11px] text-neutral-500 opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 hover:text-neutral-900 focus:opacity-100 dark:border-neutral-700 dark:bg-neutral-900/90 dark:text-neutral-400 dark:hover:text-neutral-100"
      >
        {copied ? (
          <>
            <Check className="h-3 w-3" /> Copiado
          </>
        ) : (
          <>
            <Copy className="h-3 w-3" /> Copiar
          </>
        )}
      </button>
      <pre className="scrollbar-thin overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-50 p-3.5 pt-6 text-[13px] leading-relaxed text-neutral-800 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200">
        <code className="font-mono">{children}</code>
      </pre>
    </div>
  );
}
