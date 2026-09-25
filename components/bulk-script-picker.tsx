"use client";

import { MessageSquare } from "lucide-react";

export type BulkScriptOption = {
  id: string;
  name: string;
  steps: { text: string; delayAfterSec: number; type?: "TEXT" | "IMAGE"; mediaUrl?: string }[];
};

/** Seletor de scripts compartilhado pelos envios em massa de Clientes e Pipeline. */
export function BulkScriptPicker({
  scripts,
  selectedIds,
  onToggle,
  onCreateScript,
  onPreview,
  onPreviewEnd,
}: {
  scripts: BulkScriptOption[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onCreateScript: () => void;
  onPreview?: (script: BulkScriptOption, anchor: HTMLElement) => void;
  onPreviewEnd?: () => void;
}) {
  return (
    <div className="space-y-2.5 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3 dark:border-neutral-800 dark:bg-neutral-800/30">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
          <MessageSquare className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          Mensagens
        </div>
        <button type="button" onClick={onCreateScript} className="text-sm font-semibold text-brand hover:text-brand-hover">
          + Criar script
        </button>
      </div>

      {scripts.length === 0 ? (
        <div className="border border-dashed border-neutral-300 px-4 py-5 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          Nenhum script criado.
        </div>
      ) : (
        <div className="scrollbar-thin max-h-64 space-y-1.5 overflow-y-auto pr-1">
          {scripts.map((script) => {
            const checked = selectedIds.includes(script.id);
            return (
              <label
                key={script.id}
                onMouseEnter={(event) => onPreview?.(script, event.currentTarget)}
                onMouseLeave={onPreviewEnd}
                className={`flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm transition-colors ${
                  checked
                    ? "border-[var(--brand)] bg-[var(--brand-light)] dark:bg-[var(--brand-subtle)]"
                    : "border-neutral-200 bg-white hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800/60"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(script.id)}
                  className="mt-0.5 accent-neutral-900 dark:accent-white"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-neutral-900 dark:text-neutral-100">
                    {script.name}
                    {script.steps.length > 1 && (
                      <span className="ml-1.5 text-xs font-normal text-neutral-400 dark:text-neutral-500">· {script.steps.length} mensagens</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{script.steps[0]?.text || "Sem mensagem"}</p>
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
