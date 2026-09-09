"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarClock, ClipboardX, Clock3, SlidersHorizontal, Check, X } from "lucide-react";
import type { PipelineQuickFilter } from "./pipeline-filters";

const TILES: { value: PipelineQuickFilter; label: string; icon: typeof CalendarClock }[] = [
  { value: "acao-hoje", label: "Ação hoje", icon: CalendarClock },
  { value: "sem-tarefa", label: "Sem tarefa", icon: ClipboardX },
  { value: "parados-14d", label: "Parados +14d", icon: Clock3 },
];

function pillClass(active: boolean): string {
  return `inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
    active
      ? "border-[var(--brand)] bg-[var(--brand-light)] text-[var(--brand)] dark:bg-[var(--brand-subtle)]"
      : "border-neutral-300 bg-white text-neutral-500 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800"
  }`;
}

/**
 * Ação hoje / Sem tarefa / Parados +14d — antes eram tiles grandes lá em
 * cima, ao lado do card "Valor em aberto" (ver pipeline-view.tsx), mas
 * competiam demais por atenção com o board/lista logo abaixo, e no celular
 * empilhavam em várias linhas cheias comendo altura que a coluna do Kanban
 * precisa. Viraram botões pequenos aqui, na mesma fileira de busca/filtro
 * (Kanban e Lista têm cada um a sua, mesmo componente nos dois — ver
 * kanban-board.tsx e deals-list.tsx), no mesmo peso visual do botão "Sem
 * valor" que já mora dentro do FilterPopover.
 *
 * No celular os 3 lado a lado (mais busca + botão de Filtros) não cabem
 * numa fileira só e quebravam pra uma 2ª linha cheia (print reportado:
 * "algo mais simples sem muitos botões assim") — abaixo de sm, colapsam num
 * botão só (mostra a opção ativa, ou "Filtro rápido" quando nenhuma está
 * ligada) que abre um menu pra escolher, mesmo padrão do ComparePeriodFilter
 * em Relatórios. A partir de sm sobra largura de sobra pra manter os 3
 * separados, acesso de 1 toque sem precisar abrir menu nenhum.
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
      <div className="hidden items-center gap-2 sm:flex">
        {TILES.map(({ value, label, icon: Icon }) => {
          const active = quickFilter === value;
          return (
            <button key={value} type="button" onClick={() => onToggle(value)} className={pillClass(active)}>
              <Icon className="h-3.5 w-3.5" strokeWidth={2} />
              {label}
            </button>
          );
        })}
      </div>
      <CompactQuickFilter quickFilter={quickFilter} onToggle={onToggle} />
    </>
  );
}

function CompactQuickFilter({
  quickFilter,
  onToggle,
}: {
  quickFilter: PipelineQuickFilter | null;
  onToggle: (value: PipelineQuickFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const active = TILES.find((t) => t.value === quickFilter) ?? null;

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative sm:hidden">
      <button type="button" onClick={() => setOpen((v) => !v)} className={pillClass(!!active)}>
        {active ? <active.icon className="h-3.5 w-3.5" strokeWidth={2} /> : <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={2} />}
        {active ? active.label : "Filtro rápido"}
        {active && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(active.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                onToggle(active.value);
              }
            }}
            className="-mr-1 ml-0.5 rounded-full p-0.5 hover:bg-black/5 dark:hover:bg-white/10"
            aria-label="Limpar filtro rápido"
          >
            <X className="h-3 w-3" strokeWidth={2} />
          </span>
        )}
      </button>

      {open && (
        <div className="surface-glass-filter animate-pop-in absolute left-0 z-30 mt-1 w-48 rounded-lg p-1.5 shadow-xl">
          {TILES.map(({ value, label, icon: Icon }) => {
            const isActive = quickFilter === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => {
                  onToggle(value);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
                  isActive
                    ? "bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                    : "text-neutral-600 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800/60"
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 opacity-60" strokeWidth={2} />
                  {label}
                </span>
                {isActive && <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
