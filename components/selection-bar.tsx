"use client";

import { X } from "lucide-react";

/**
 * Barra minimalista que substitui/antecede a barra de busca quando existe
 * seleção em massa ativa (Clientes, Negócios) — só o essencial: contagem,
 * as ações (children, um `BulkActionPopover`/botão por ação) e um jeito de
 * limpar a seleção. Fica escondida por completo quando `count` é 0 (o
 * chamador decide isso, este componente só desenha a barra em si).
 */
export function SelectionBar({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50/80 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-800/40">
      <span className="font-medium text-neutral-700 dark:text-neutral-300">
        {count} selecionado{count === 1 ? "" : "s"}
      </span>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
      <button
        type="button"
        onClick={onClear}
        aria-label="Limpar seleção"
        className="icon-btn ml-auto h-7 w-7"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}
