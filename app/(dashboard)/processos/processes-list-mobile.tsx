"use client";

import Link from "next/link";
import { Search, SearchX, Layers } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { EmptyState } from "@/components/empty-state";
import { FilterPopover } from "@/components/filter-popover";
import { useProcessFilters, ProcessFilterFields, ProcessCardContent, type ProcessItem } from "./process-kanban-board";

type Stage = { id: string; name: string; color: string | null; order: number };

/**
 * Versão mobile de Processos — nada de kanban horizontal aqui. A maioria de
 * quem abre essa tela no celular é consultor (só enxerga os próprios
 * processos, sem poder arrastar nada — ver lib/processes/access.ts), então
 * uma lista vertical agrupada por etapa (mesma ideia de
 * agenda/tasks-list-mobile.tsx) serve muito melhor que forçar 5 colunas de
 * 288px numa tela de ~375px. Mover de etapa continua possível — só que pela
 * página de detalhe (o seletor horizontal de etapas de lá já é o jeito
 * mobile-friendly de fazer isso), não arrastando cards aqui.
 */
export function ProcessesListMobile({ stages, processes }: { stages: Stage[]; processes: ProcessItem[] }) {
  const { search, setSearch, documentFilter, setDocumentFilter, hasFilters, clearFilters, filtered } = useProcessFilters(processes);

  const isEmpty = processes.length === 0;
  const noResults = !isEmpty && filtered.length === 0;

  return (
    <div className="space-y-4">
      {!isEmpty && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
              strokeWidth={2}
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar cliente ou negócio"
              className="field-input py-2 pl-8 text-sm"
            />
          </div>
          <FilterPopover active={hasFilters} onClear={clearFilters}>
            <ProcessFilterFields documentFilter={documentFilter} setDocumentFilter={setDocumentFilter} />
          </FilterPopover>
        </div>
      )}

      {isEmpty ? (
        <div className="card">
          <EmptyState icon={Layers} title="Nenhum processo por aqui" description="Processos aparecem sozinhos quando um negócio é marcado como ganho." />
        </div>
      ) : noResults ? (
        <div className="card">
          <EmptyState icon={SearchX} title="Nenhum processo encontrado" description="Ajuste a busca ou limpe os filtros." />
        </div>
      ) : (
        <div className="space-y-5">
          {stages.map((stage) => {
            const stageProcesses = filtered.filter((p) => p.stageId === stage.id);
            if (stageProcesses.length === 0) return null;
            const total = stageProcesses.reduce((sum, p) => sum + (p.deal.value ?? 0), 0);

            return (
              <div key={stage.id}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: stage.color ?? "#999" }} />
                  <h2 className="min-w-0 truncate text-sm font-medium text-neutral-700 dark:text-neutral-300">{stage.name}</h2>
                  {total > 0 && <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">{formatCurrency(total)}</span>}
                  <span className="ml-auto shrink-0 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                    {stageProcesses.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {stageProcesses.map((process) => (
                    <Link key={process.id} href={`/processos/${process.id}`} className="block active:scale-[0.99]">
                      <ProcessCardContent process={process} />
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
