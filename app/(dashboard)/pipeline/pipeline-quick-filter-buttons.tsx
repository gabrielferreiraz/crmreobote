"use client";

import { CalendarClock, ClipboardX, Clock3 } from "lucide-react";
import type { PipelineQuickFilter } from "./pipeline-filters";

const TILES: { value: PipelineQuickFilter; label: string; icon: typeof CalendarClock }[] = [
  { value: "acao-hoje", label: "Ação hoje", icon: CalendarClock },
  { value: "sem-tarefa", label: "Sem tarefa", icon: ClipboardX },
  { value: "parados-14d", label: "Parados +14d", icon: Clock3 },
];

/**
 * Ação hoje / Sem tarefa / Parados +14d — antes eram tiles grandes lá em
 * cima, ao lado do card "Valor em aberto" (ver pipeline-view.tsx), mas
 * competiam demais por atenção com o board/lista logo abaixo, e no celular
 * empilhavam em várias linhas cheias comendo altura que a coluna do Kanban
 * precisa. Viraram botões pequenos aqui, na mesma fileira de busca/filtro
 * (Kanban e Lista têm cada um a sua, mesmo componente nos dois — ver
 * kanban-board.tsx e deals-list.tsx), no mesmo peso visual do botão "Sem
 * valor" que já mora dentro do FilterPopover.
 */
export function PipelineQuickFilterButtons({
  quickFilter,
  onToggle,
}: {
  quickFilter: PipelineQuickFilter | null;
  onToggle: (value: PipelineQuickFilter) => void;
}) {
  return (
    <>
      {TILES.map(({ value, label, icon: Icon }) => {
        const active = quickFilter === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onToggle(value)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              active
                ? "border-[var(--brand)] bg-[var(--brand-light)] text-[var(--brand)] dark:bg-[var(--brand-subtle)]"
                : "border-neutral-300 bg-white text-neutral-500 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800"
            }`}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={2} />
            {label}
          </button>
        );
      })}
    </>
  );
}
