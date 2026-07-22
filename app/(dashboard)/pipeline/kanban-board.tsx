"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import Link from "next/link";
import { Search, AlertTriangle } from "lucide-react";
import { formatCurrency, daysSince } from "@/lib/format";
import { isStale } from "@/lib/stale";
import { Avatar } from "@/components/avatar";
import { FilterPopover } from "@/components/filter-popover";
import { Select } from "@/components/select";
import { TASK_TYPE_ICON, TASK_TYPE_LABELS } from "@/lib/task-icons";

type Stage = { id: string; name: string; color: string | null; order: number };

const CREDIT_TYPE_BADGE: Record<string, string> = {
  "IMÓVEL":
    "border-emerald-200/60 bg-emerald-50/60 text-emerald-700/80 dark:border-emerald-800/40 dark:bg-emerald-500/5 dark:text-emerald-400/70",
  "VEÍCULO":
    "border-slate-200/60 bg-slate-50/60 text-slate-600/80 dark:border-slate-700/40 dark:bg-slate-500/5 dark:text-slate-400/70",
};
const CREDIT_TYPE_BADGE_DEFAULT =
  "border-neutral-200 bg-neutral-50 text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-400";

export type Deal = {
  id: string;
  name: string;
  creditType: string | null;
  value: number | null;
  status: "OPEN" | "WON" | "LOST";
  stageId: string;
  stageEnteredAt: string | Date;
  createdAt: string | Date;
  closedAt: string | Date | null;
  stage: { id: string; name: string; color: string | null };
  contact: { id: string; name: string; source: string | null; jobTitle: string | null };
  owner: { id: string; name: string; photoUrl: string | null };
  nextActivity: string | null;
  taskTypes: string[];
  hasUnreadWhatsApp: boolean;
  lossReasonId: string | null;
  lossReason: { id: string; label: string } | null;
};

type MemberOption = { id: string; name: string };

export function KanbanBoard({
  stages,
  deals,
  onDealsChange,
  members,
}: {
  stages: Stage[];
  deals: Deal[];
  onDealsChange: (updater: (prev: Deal[]) => Deal[]) => void;
  members: MemberOption[];
}) {
  const [activeDeal, setActiveDeal] = useState<Deal | null>(null);
  const [pending, setPending] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  // Mouse: começa a arrastar assim que o ponteiro se move um pouco (não
  // precisa segurar). Toque: precisa segurar ~escondido uns 250ms parado —
  // senão TODO arrastar de dedo (inclusive um simples scroll da lista pro
  // lado) virava início de drag, e dava pra rolar o funil no celular.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
  );

  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [jobTitleFilter, setJobTitleFilter] = useState("");
  const [staleOnly, setStaleOnly] = useState(false);

  const openDeals = useMemo(() => deals.filter((d) => d.status === "OPEN"), [deals]);

  const sourceOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of openDeals) if (d.contact.source) set.add(d.contact.source);
    return Array.from(set).sort();
  }, [openDeals]);

  const jobTitleOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of openDeals) if (d.contact.jobTitle) set.add(d.contact.jobTitle);
    return Array.from(set).sort();
  }, [openDeals]);

  const hasFilters = !!search || !!ownerFilter || !!sourceFilter || !!jobTitleFilter || staleOnly;

  function clearFilters() {
    setSearch("");
    setOwnerFilter("");
    setSourceFilter("");
    setJobTitleFilter("");
    setStaleOnly(false);
  }

  const filteredDeals = useMemo(() => {
    const term = search.trim().toLowerCase();
    return openDeals.filter((d) => {
      if (term && !d.name.toLowerCase().includes(term) && !d.contact.name.toLowerCase().includes(term)) {
        return false;
      }
      if (ownerFilter && d.owner.id !== ownerFilter) return false;
      if (sourceFilter && d.contact.source !== sourceFilter) return false;
      if (jobTitleFilter && d.contact.jobTitle !== jobTitleFilter) return false;
      if (staleOnly && !isStale(d.stageEnteredAt)) return false;
      return true;
    });
  }, [openDeals, search, ownerFilter, sourceFilter, jobTitleFilter, staleOnly]);

  function handleDragStart(event: DragStartEvent) {
    const deal = openDeals.find((d) => d.id === event.active.id);
    setActiveDeal(deal ?? null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveDeal(null);
    if (!over) return;

    const dealId = active.id as string;
    const targetStageId = over.id as string;
    const deal = openDeals.find((d) => d.id === dealId);
    if (!deal || deal.stageId === targetStageId) return;

    const previousStageId = deal.stageId;
    setMoveError(null);
    onDealsChange((prev) =>
      prev.map((d) =>
        d.id === dealId ? { ...d, stageId: targetStageId, stageEnteredAt: new Date() } : d,
      ),
    );
    setPending(true);

    const res = await fetch(`/api/deals/${dealId}/move`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stageId: targetStageId }),
    });

    setPending(false);

    if (!res.ok) {
      onDealsChange((prev) =>
        prev.map((d) => (d.id === dealId ? { ...d, stageId: previousStageId } : d)),
      );
      const data = await res.json().catch(() => ({}));
      setMoveError(data.error ?? "Não foi possível mover o negócio");
    }
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
            strokeWidth={2}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar negócio ou contato"
            className="field-input w-56 py-1.5 pl-8 text-sm"
          />
        </div>
        <FilterPopover active={hasFilters} onClear={clearFilters}>
          <div className="space-y-1">
            <label className="field-label">Responsável</label>
            <Select
              value={ownerFilter}
              onChange={setOwnerFilter}
              className="w-full py-1.5 text-sm"
              options={[
                { value: "", label: "Todos os responsáveis" },
                ...members.map((m) => ({ value: m.id, label: m.name })),
              ]}
            />
          </div>
          {sourceOptions.length > 0 && (
            <div className="space-y-1">
              <label className="field-label">Origem</label>
              <Select
                value={sourceFilter}
                onChange={setSourceFilter}
                className="w-full py-1.5 text-sm"
                options={[
                  { value: "", label: "Todas as origens" },
                  ...sourceOptions.map((s) => ({ value: s, label: s })),
                ]}
              />
            </div>
          )}
          {jobTitleOptions.length > 0 && (
            <div className="space-y-1">
              <label className="field-label">Cargo</label>
              <Select
                value={jobTitleFilter}
                onChange={setJobTitleFilter}
                className="w-full py-1.5 text-sm"
                options={[
                  { value: "", label: "Todos os cargos" },
                  ...jobTitleOptions.map((j) => ({ value: j, label: j })),
                ]}
              />
            </div>
          )}
          <button
            onClick={() => setStaleOnly((v) => !v)}
            className={`inline-flex w-full items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
              staleOnly
                ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300"
                : "border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />
            Só parados
          </button>
        </FilterPopover>
      </div>

      {moveError && (
        <p className="shrink-0 text-xs text-red-600 dark:text-red-400">{moveError}</p>
      )}

      <DndContext
        id="kanban-board"
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="scrollbar-thin flex flex-1 gap-3 overflow-x-auto pb-4">
          {stages.map((stage) => (
            <StageColumn
              key={stage.id}
              stage={stage}
              deals={filteredDeals.filter((d) => d.stageId === stage.id)}
              disabled={pending}
            />
          ))}
        </div>
        <DragOverlay>{activeDeal ? <DealCard deal={activeDeal} overlay /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}

function StageColumn({
  stage,
  deals,
  disabled,
}: {
  stage: Stage;
  deals: Deal[];
  disabled: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id, disabled });
  const total = deals.reduce((sum, d) => sum + (d.value ?? 0), 0);

  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col rounded-lg border bg-neutral-100/50 dark:bg-neutral-800/40 transition-colors ${
        isOver ? "border-neutral-900 dark:border-white bg-neutral-100 dark:bg-neutral-800 ring-1 ring-neutral-900 dark:ring-white" : "border-neutral-200 dark:border-neutral-800"
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: stage.color ?? "#999" }} />
        <span className="text-xs font-semibold tracking-wide text-neutral-600 dark:text-neutral-400 uppercase">
          {stage.name}
        </span>
        {total > 0 && (
          <span className="truncate text-[10px] font-medium text-neutral-400 dark:text-neutral-500">
            {formatCurrency(total)}
          </span>
        )}
        <span className="ml-auto shrink-0 rounded-full bg-neutral-200/70 dark:bg-neutral-800/70 px-1.5 py-0.5 text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
          {deals.length}
        </span>
      </div>
      <div className="scrollbar-thin flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {deals.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-neutral-400 dark:text-neutral-500">Nenhum negócio</p>
        )}
        {deals.map((deal) => (
          <DealCard key={deal.id} deal={deal} />
        ))}
      </div>
    </div>
  );
}

function DealCard({ deal, overlay }: { deal: Deal; overlay?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: deal.id,
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  const hasTasks = deal.taskTypes.length > 0;
  const stale = isStale(deal.stageEnteredAt);

  const content = (
    <div
      className={`relative rounded-lg border bg-white p-3 text-sm shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all hover:-translate-y-0.5 hover:shadow-md dark:bg-neutral-900 ${
        stale
          ? "border-neutral-200 border-l-2 border-l-amber-500/70 dark:border-neutral-800 dark:border-l-amber-500/50"
          : "border-neutral-200 dark:border-neutral-800"
      } ${isDragging ? "opacity-40" : ""}`}
    >
      {deal.hasUnreadWhatsApp && (
        <span className="absolute -top-1.5 -right-1.5 flex h-3 w-3" title="O lead respondeu">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-red-600" />
        </span>
      )}
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate font-medium text-neutral-900 dark:text-neutral-100">{deal.name}</p>
        <Avatar
          name={deal.owner.name}
          src={deal.owner.photoUrl}
          size="xs"
          className="transition-shadow hover:ring-2 hover:ring-neutral-300 hover:ring-offset-2 hover:ring-offset-white dark:hover:ring-neutral-600 dark:hover:ring-offset-neutral-900"
        />
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
      <div className="mt-1.5 flex items-center gap-1.5">
        {hasTasks ? (
          deal.taskTypes.map((type) => {
            const Icon = TASK_TYPE_ICON[type] ?? TASK_TYPE_ICON.OTHER;
            return (
              <span key={type} title={TASK_TYPE_LABELS[type] ?? type}>
                <Icon className="h-3.5 w-3.5 text-neutral-600 dark:text-neutral-400" strokeWidth={2} />
              </span>
            );
          })
        ) : (
          <span
            className="inline-flex items-center gap-1 rounded bg-red-100/70 dark:bg-red-950/30 px-1.5 py-0.5 text-[10px] font-bold text-red-600 dark:text-red-400 border border-red-200/50 dark:border-red-900/30 uppercase tracking-wide animate-pulse"
            title="Sem tarefa agendada! Crie uma tarefa."
          >
            <AlertTriangle className="h-3 w-3 text-red-600 dark:text-red-400" strokeWidth={2.5} />
            Sem tarefa!
          </span>
        )}
      </div>
      <div className="mt-2.5 flex items-center justify-between">
        <span className="text-xs font-medium tabular-nums text-neutral-700 dark:text-neutral-300">
          {formatCurrency(deal.value)}
        </span>
        <span
          className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${
            stale ? "text-amber-600 dark:text-amber-500" : "text-neutral-400 dark:text-neutral-500"
          }`}
        >
          {stale && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />}
          {daysSince(deal.stageEnteredAt)}d
        </span>
      </div>
    </div>
  );

  if (overlay) return content;

  return (
    // touch-manipulation (não touch-none): deixa o navegador rolar
    // normalmente ao arrastar o dedo — o TouchSensor com delay acima é quem
    // decide se virou um drag de verdade (dedo parado ~250ms) ou só um scroll.
    <div ref={setNodeRef} style={style} {...listeners} {...attributes} className="touch-manipulation">
      <Link href={`/negocios/${deal.id}`} onClick={(e) => isDragging && e.preventDefault()}>
        {content}
      </Link>
    </div>
  );
}
