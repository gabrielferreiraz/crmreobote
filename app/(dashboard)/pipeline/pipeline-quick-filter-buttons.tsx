"use client";

import { CalendarClock, ClipboardX, Clock3, AlertTriangle, X } from "lucide-react";
import type { PipelineQuickFilter } from "./pipeline-filters";

const LABELS: Record<PipelineQuickFilter, { label: string; icon: typeof CalendarClock }> = {
  "acao-hoje": { label: "Ação hoje", icon: CalendarClock },
  "sem-tarefa": { label: "Sem tarefa", icon: ClipboardX },
  "parados-14d": { label: "Parados +14d", icon: Clock3 },
  "sem-valor": { label: "Sem valor", icon: AlertTriangle },
};

/**
 * AVISO de filtro rápido ativo — não mais um seletor.
 *
 * Antes eram 3 botões fixos na fileira de busca (Ação hoje / Sem tarefa /
 * Parados +14d, mais um menu colapsado no celular). Removidos a pedido
 * explícito: "os consultores não estão usando". Só que o parâmetro `?filter=`
 * da URL continua vivo, porque o card "Exige ação" do Início linka pra cá
 * já filtrado (ver app/(dashboard)/action-required-card.tsx) — e sem os
 * botões, esse filtro chegaria invisível e sem liga/desliga: a pessoa veria
 * meio funil, não teria como voltar (o "Limpar filtros" da tela não mexe
 * neste, que mora em pipeline-view.tsx) e concluiria que o Pipeline quebrou.
 *
 * Então sobra só isto: nada aparece no caso normal (sem filtro), e quando
 * vem um pela URL aparece um chip único dizendo o que está filtrado, com um
 * ✕ que desliga. Um elemento, e só quando é necessário — em vez de três
 * permanentes que ninguém clicava.
 */
export function PipelineQuickFilterNotice({
  quickFilter,
  onClear,
}: {
  quickFilter: PipelineQuickFilter | null;
  onClear: (value: PipelineQuickFilter) => void;
}) {
  if (!quickFilter) return null;
  const { label, icon: Icon } = LABELS[quickFilter];

  return (
    <div className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--brand)] bg-[var(--brand-light)] px-2.5 py-1.5 text-xs font-medium text-[var(--brand)] dark:bg-[var(--brand-subtle)]">
      <Icon className="h-3.5 w-3.5" strokeWidth={2} />
      <span>
        Filtrado: <strong className="font-semibold">{label}</strong>
      </span>
      <button
        type="button"
        onClick={() => onClear(quickFilter)}
        aria-label={`Remover filtro ${label}`}
        className="-mr-1 ml-0.5 rounded-full p-0.5 transition-colors hover:bg-black/10 dark:hover:bg-white/15"
      >
        <X className="h-3 w-3" strokeWidth={2.5} />
      </button>
    </div>
  );
}
