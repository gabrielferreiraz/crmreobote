"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, AlertTriangle, Inbox } from "lucide-react";
import { formatCurrency, daysSince } from "@/lib/format";
import { isStale } from "@/lib/stale";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { TASK_TYPE_ICON, TASK_TYPE_LABELS } from "@/lib/task-icons";
import type { Deal } from "./kanban-board";

type Stage = { id: string; name: string; color: string | null; order: number };

const CREDIT_TYPE_BADGE: Record<string, string> = {
  "IMÓVEL":
    "border-emerald-200/60 bg-emerald-50/60 text-emerald-700/80 dark:border-emerald-800/40 dark:bg-emerald-500/5 dark:text-emerald-400/70",
  "VEÍCULO":
    "border-slate-200/60 bg-slate-50/60 text-slate-600/80 dark:border-slate-700/40 dark:bg-slate-500/5 dark:text-slate-400/70",
};
const CREDIT_TYPE_BADGE_DEFAULT =
  "border-neutral-200 bg-neutral-50 text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-400";

/**
 * Pipeline no celular: arrastar cartão entre colunas não funciona bem no
 * toque (e nem cabe), então aqui a navegação é por abas de etapa + lista
 * vertical. Mudar de etapa de verdade é feito dentro do próprio negócio
 * (a barra de etapas já existe lá e já é boa no toque).
 */
export function PipelineMobile({
  stages,
  deals,
}: {
  stages: Stage[];
  deals: Deal[];
}) {
  const openDeals = useMemo(() => deals.filter((d) => d.status === "OPEN"), [deals]);
  const [activeStageId, setActiveStageId] = useState(stages[0]?.id ?? "");
  const [search, setSearch] = useState("");

  const countByStage = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of openDeals) map.set(d.stageId, (map.get(d.stageId) ?? 0) + 1);
    return map;
  }, [openDeals]);

  const filteredDeals = useMemo(() => {
    const term = search.trim().toLowerCase();
    return openDeals.filter((d) => {
      if (d.stageId !== activeStageId) return false;
      if (term && !d.name.toLowerCase().includes(term) && !d.contact.name.toLowerCase().includes(term)) {
        return false;
      }
      return true;
    });
  }, [openDeals, activeStageId, search]);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="relative shrink-0">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
          strokeWidth={2}
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar negócio ou contato"
          className="field-input py-2 pl-8 text-sm"
        />
      </div>

      <div className="scrollbar-thin flex shrink-0 gap-1.5 overflow-x-auto pb-1">
        {stages.map((stage) => {
          const isActive = stage.id === activeStageId;
          const count = countByStage.get(stage.id) ?? 0;
          return (
            <button
              key={stage.id}
              onClick={() => setActiveStageId(stage.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-medium whitespace-nowrap transition-colors active:scale-[0.97] ${
                isActive
                  ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                  : "border-neutral-200 bg-white text-neutral-600 active:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400 dark:active:bg-neutral-800"
              }`}
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: isActive ? "currentColor" : (stage.color ?? "#999") }}
              />
              {stage.name}
              <span className={isActive ? "opacity-70" : "text-neutral-400 dark:text-neutral-500"}>{count}</span>
            </button>
          );
        })}
      </div>

      <div className="scrollbar-thin flex-1 space-y-2 overflow-y-auto">
        {filteredDeals.length === 0 ? (
          <div className="pt-10">
            <EmptyState
              icon={Inbox}
              title="Nenhum negócio aqui"
              description="Essa etapa está vazia ou nada bate com a busca."
            />
          </div>
        ) : (
          filteredDeals.map((deal) => <MobileDealCard key={deal.id} deal={deal} />)
        )}
      </div>
    </div>
  );
}

function MobileDealCard({ deal }: { deal: Deal }) {
  const stale = isStale(deal.stageEnteredAt);

  return (
    <Link
      href={`/negocios/${deal.id}`}
      className={`relative block rounded-lg border bg-white p-3 text-sm transition-transform active:scale-[0.99] active:bg-neutral-50 dark:bg-neutral-900 dark:active:bg-neutral-800/60 ${
        stale
          ? "border-neutral-200 border-l-2 border-l-amber-500/70 dark:border-neutral-800 dark:border-l-amber-500/50"
          : "border-neutral-200 dark:border-neutral-800"
      }`}
    >
      {deal.hasUnreadWhatsApp && (
        <span className="absolute -top-1.5 -right-1.5 flex h-3 w-3" title="O lead respondeu">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-red-600" />
        </span>
      )}
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate font-medium text-neutral-900 dark:text-neutral-100">{deal.name}</p>
        <Avatar name={deal.owner.name} src={deal.owner.photoUrl} size="xs" className="shrink-0" />
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs text-neutral-500 dark:text-neutral-400">{deal.contact.name}</p>
        {deal.creditType && (
          <span
            className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap ${
              CREDIT_TYPE_BADGE[deal.creditType] ?? CREDIT_TYPE_BADGE_DEFAULT
            }`}
          >
            {deal.creditType}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {deal.taskTypes.length > 0 ? (
            deal.taskTypes.map((type) => {
              const Icon = TASK_TYPE_ICON[type] ?? TASK_TYPE_ICON.OTHER;
              return (
                <span key={type} title={TASK_TYPE_LABELS[type] ?? type}>
                  <Icon className="h-3 w-3 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
                </span>
              );
            })
          ) : (
            <AlertTriangle className="h-3 w-3 text-red-600 dark:text-red-400" strokeWidth={2} />
          )}
        </div>
        <span className="shrink-0 text-xs font-medium whitespace-nowrap tabular-nums text-neutral-700 dark:text-neutral-300">
          {formatCurrency(deal.value)}
        </span>
        <span
          className={`shrink-0 inline-flex items-center gap-1 text-[11px] font-medium ${
            stale ? "text-amber-600 dark:text-amber-500" : "text-neutral-400 dark:text-neutral-500"
          }`}
        >
          {stale && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />}
          {daysSince(deal.stageEnteredAt)}d
        </span>
      </div>
    </Link>
  );
}
