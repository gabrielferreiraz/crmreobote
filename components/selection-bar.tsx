"use client";

import { X } from "lucide-react";

/**
 * Chip compacto de ações em massa (Clientes, Negócios) — o chamador só
 * monta isso quando `count > 0` (dentro da própria linha de busca/filtro,
 * empurrado pro canto direito com `ml-auto`), então nunca ocupa uma linha
 * própria nem empurra a tabela pra baixo. Entra com o mesmo fade+scale sutil
 * (`animate-pop-in`) já usado nos outros menus/dropdowns pequenos do app.
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
    <div className="animate-pop-in flex flex-wrap items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50/80 px-2.5 py-1.5 text-xs dark:border-neutral-800 dark:bg-neutral-800/40">
      <span className="font-medium text-neutral-700 dark:text-neutral-300">
        {count} selecionado{count === 1 ? "" : "s"}
      </span>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
      <button type="button" onClick={onClear} aria-label="Limpar seleção" className="icon-btn h-6 w-6">
        <X className="h-3 w-3" strokeWidth={2} />
      </button>
    </div>
  );
}
