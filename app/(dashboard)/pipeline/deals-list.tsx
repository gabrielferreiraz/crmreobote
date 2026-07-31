"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, SearchX, Inbox, GitBranch, Layers, User, Send, Trash2, Loader2 } from "lucide-react";
import { formatCurrency, daysSince } from "@/lib/format";
import { brazilDateStringToUTC, brazilEndOfDayUTC } from "@/lib/timezone";
import { EmptyState } from "@/components/empty-state";
import { Avatar } from "@/components/avatar";
import { FilterPopover } from "@/components/filter-popover";
import { Select } from "@/components/select";
import { DateRangeField } from "@/components/date-range-calendar";
import { SelectionBar } from "@/components/selection-bar";
import { BulkActionPopover } from "@/components/bulk-action-popover";
import { SelectPopoverBody } from "@/components/select-popover-body";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { BulkSendMessageDialog } from "@/components/bulk-send-message-dialog";
import { Pagination } from "@/components/pagination";
import { buildListQuickRanges } from "@/lib/date-ranges";
import { countBulkFailures } from "@/lib/bulk-fetch";
import { saveBulkSendDraft, type BulkSendDraft } from "@/lib/pipeline-bulk-send-draft";
import type { Deal } from "./kanban-board";

const QUICK_RANGES = buildListQuickRanges();
const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];
const DEFAULT_PAGE_SIZE = 50;
/** Nenhum negócio de verdade tem esse id de responsável — usado quando o
 * filtro de "responsável X" + "status do consultor" (ativo/inativo) se
 * contradizem (ex.: escolheu um responsável específico E "só inativos", mas
 * esse responsável está ativo), forçando zero resultados sem precisar de um
 * caminho de código separado pra esse caso. */
const IMPOSSIBLE_OWNER_ID = "__none__";

type MemberOption = { id: string; name: string; active: boolean };
type Stage = { id: string; name: string; color: string | null };
type LossReasonOption = { id: string; label: string };
type PipelineOption = { id: string; name: string; stages: { id: string; name: string }[] };
type Sums = { wonSum: number; lostSum: number; totalSum: number };

const STATUS_LABELS: Record<Deal["status"], string> = {
  OPEN: "Em andamento",
  WON: "Ganho",
  LOST: "Perdido",
};

export function DealsList({
  initialDeals,
  initialTotalCount,
  initialSums,
  reloadToken,
  members,
  stages,
  pipelineId,
  pipelines,
  lossReasons,
  canBulkDelete,
  canBulkMessage,
  restoredDraft,
}: {
  initialDeals: Deal[];
  /** Total do pipeline inteiro (sem filtro nenhum) na 1ª carga — depois disso, `totalCount` no state reflete o filtro atual. */
  initialTotalCount: number;
  initialSums: Sums;
  /** Incrementado pelo componente pai (novo negócio criado, importação concluída) pra forçar buscar de novo a página/filtro atual. */
  reloadToken: number;
  members: MemberOption[];
  stages: Stage[];
  pipelineId: string;
  pipelines: PipelineOption[];
  lossReasons: LossReasonOption[];
  canBulkDelete: boolean;
  canBulkMessage: boolean;
  restoredDraft: BulkSendDraft | null;
}) {
  const router = useRouter();

  const [deals, setDeals] = useState(initialDeals);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [sums, setSums] = useState(initialSums);
  const [loading, setLoading] = useState(false);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Deal["status"] | "">("OPEN");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [ownerStatusFilter, setOwnerStatusFilter] = useState<"" | "active" | "inactive">("");
  const [stageFilter, setStageFilter] = useState("");
  const [lossReasonFilter, setLossReasonFilter] = useState("");
  const [jobTitleFilter, setJobTitleFilter] = useState("");
  const [originFilter, setOriginFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [closedFrom, setClosedFrom] = useState("");
  const [closedTo, setClosedTo] = useState("");

  // Debounce só do texto — os demais filtros já resetam a página e buscam na
  // hora (ver os handlers "with reset" abaixo).
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // 1ª renderização já tem os dados certos (vieram prontos do servidor,
  // página 1, sem filtro) — sem essa guarda, esse efeito dispararia uma
  // busca redundante assim que montasse.
  const skipNextFetch = useRef(true);

  useEffect(() => {
    if (skipNextFetch.current) {
      skipNextFetch.current = false;
      return;
    }
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ pipelineId, skip: String((page - 1) * pageSize), limit: String(pageSize) });
    if (debouncedSearch) params.set("q", debouncedSearch);
    if (statusFilter) params.set("status", statusFilter);
    if (ownerFilter && ownerStatusFilter) {
      const isActive = members.find((m) => m.id === ownerFilter)?.active ?? true;
      const matches = ownerStatusFilter === "active" ? isActive : !isActive;
      params.set("ownerId", matches ? ownerFilter : IMPOSSIBLE_OWNER_ID);
    } else if (ownerFilter) {
      params.set("ownerId", ownerFilter);
    } else if (ownerStatusFilter) {
      const ids = members.filter((m) => (ownerStatusFilter === "active" ? m.active : !m.active)).map((m) => m.id);
      params.set("ownerId", ids.length > 0 ? ids.join(",") : IMPOSSIBLE_OWNER_ID);
    }
    if (stageFilter) params.set("stageId", stageFilter);
    if (lossReasonFilter) params.set("lossReasonId", lossReasonFilter);
    if (jobTitleFilter) params.set("jobTitle", jobTitleFilter);
    if (originFilter) params.set("source", originFilter);
    if (dateFrom) params.set("createdFrom", brazilDateStringToUTC(dateFrom).toISOString());
    if (dateTo) params.set("createdTo", brazilEndOfDayUTC(dateTo).toISOString());
    if (closedFrom) params.set("closedFrom", brazilDateStringToUTC(closedFrom).toISOString());
    if (closedTo) params.set("closedTo", brazilEndOfDayUTC(closedTo).toISOString());

    fetch(`/api/deals?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const data: Deal[] = await res.json();
        if (cancelled) return;
        setDeals(data);
        setTotalCount(Number(res.headers.get("X-Total-Count") ?? data.length));
        setSums({
          wonSum: Number(res.headers.get("X-Won-Sum") ?? 0),
          lostSum: Number(res.headers.get("X-Lost-Sum") ?? 0),
          totalSum: Number(res.headers.get("X-Total-Sum") ?? 0),
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pipelineId,
    page,
    pageSize,
    debouncedSearch,
    statusFilter,
    ownerFilter,
    ownerStatusFilter,
    stageFilter,
    lossReasonFilter,
    jobTitleFilter,
    originFilter,
    dateFrom,
    dateTo,
    closedFrom,
    closedTo,
    reloadToken,
  ]);

  const jobTitleOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of deals) if (d.contact.jobTitle) set.add(d.contact.jobTitle);
    return Array.from(set).sort();
  }, [deals]);

  const originOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of deals) if (d.contact.source) set.add(d.contact.source);
    return Array.from(set).sort();
  }, [deals]);

  const hasFilters =
    statusFilter !== "OPEN" ||
    !!ownerFilter ||
    !!ownerStatusFilter ||
    !!stageFilter ||
    !!lossReasonFilter ||
    !!jobTitleFilter ||
    !!originFilter ||
    !!dateFrom ||
    !!dateTo ||
    !!closedFrom ||
    !!closedTo;

  function clearFilters() {
    setStatusFilter("OPEN");
    setOwnerFilter("");
    setOwnerStatusFilter("");
    setStageFilter("");
    setLossReasonFilter("");
    setJobTitleFilter("");
    setOriginFilter("");
    setDateFrom("");
    setDateTo("");
    setClosedFrom("");
    setClosedTo("");
    setPage(1);
  }

  function applyClosedQuickRange(range: { from: string; to: string }) {
    setClosedFrom(range.from);
    setClosedTo(range.to);
    setPage(1);
  }

  // Pra ida-e-volta de "+ Criar script" (ver components/bulk-send-message-dialog.tsx
  // e lib/pipeline-bulk-send-draft.ts) — captura tudo que precisa sobreviver
  // à navegação e restaura de volta.
  function captureFilters(): Record<string, string> {
    return {
      search,
      statusFilter,
      ownerFilter,
      ownerStatusFilter,
      stageFilter,
      lossReasonFilter,
      jobTitleFilter,
      originFilter,
      dateFrom,
      dateTo,
      closedFrom,
      closedTo,
    };
  }

  function restoreFilters(f: Record<string, string>) {
    if (f.search !== undefined) setSearch(f.search);
    if (f.statusFilter !== undefined) setStatusFilter(f.statusFilter as Deal["status"] | "");
    if (f.ownerFilter !== undefined) setOwnerFilter(f.ownerFilter);
    if (f.ownerStatusFilter !== undefined) setOwnerStatusFilter(f.ownerStatusFilter as "" | "active" | "inactive");
    if (f.stageFilter !== undefined) setStageFilter(f.stageFilter);
    if (f.lossReasonFilter !== undefined) setLossReasonFilter(f.lossReasonFilter);
    if (f.jobTitleFilter !== undefined) setJobTitleFilter(f.jobTitleFilter);
    if (f.originFilter !== undefined) setOriginFilter(f.originFilter);
    if (f.dateFrom !== undefined) setDateFrom(f.dateFrom);
    if (f.dateTo !== undefined) setDateTo(f.dateTo);
    if (f.closedFrom !== undefined) setClosedFrom(f.closedFrom);
    if (f.closedTo !== undefined) setClosedTo(f.closedTo);
    setPage(1);
  }

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkSendOpen, setBulkSendOpen] = useState(false);

  // Restaura filtro/seleção depois de voltar de "+ Criar script" e reabre o
  // diálogo de envio sozinho — o script recém-criado já aparece no picker
  // (busca de novo ao abrir, ver BulkSendMessageDialog). restoredDraft só
  // muda uma vez (pipeline-view.tsx faz um pop de uso único), então isso
  // roda no máximo uma vez por sessão de navegação, não em todo re-render.
  useEffect(() => {
    if (!restoredDraft) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    restoreFilters(restoredDraft.filters);
    setSelectedIds(new Set(restoredDraft.selectedIds));
    setBulkSendOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoredDraft]);

  function handleCreateScript() {
    saveBulkSendDraft({ filters: captureFilters(), selectedIds: Array.from(selectedIds) });
    router.push(`/whatsapp/scripts/novo?returnTo=${encodeURIComponent("/pipeline")}`);
  }

  // Seleção opera só sobre a página atual — "selecionar tudo" seleciona no
  // máximo `pageSize` negócios (antes, com "carregar mais", podia acumular
  // milhares na memória; com paginação de verdade não tem mais um superset
  // pra selecionar de outras páginas).
  const allSelected = deals.length > 0 && deals.every((d) => selectedIds.has(d.id));

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const d of deals) next.delete(d.id);
      } else {
        for (const d of deals) next.add(d.id);
      }
      return next;
    });
  }

  function toggleSelect(id: string, shiftKey?: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const isSelecting = !next.has(id);

      if (isSelecting) {
        next.add(id);
      } else {
        next.delete(id);
      }

      if (shiftKey && lastSelectedId && lastSelectedId !== id) {
        const lastIndex = deals.findIndex((d) => d.id === lastSelectedId);
        const currentIndex = deals.findIndex((d) => d.id === id);
        if (lastIndex !== -1 && currentIndex !== -1) {
          const start = Math.min(lastIndex, currentIndex);
          const end = Math.max(lastIndex, currentIndex);
          for (let i = start; i <= end; i++) {
            const dealId = deals[i].id;
            if (isSelecting) {
              next.add(dealId);
            } else {
              next.delete(dealId);
            }
          }
        }
      }

      if (isSelecting) {
        setLastSelectedId(id);
      } else if (lastSelectedId === id) {
        setLastSelectedId(null);
      }

      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setLastSelectedId(null);
    setBulkError(null);
  }

  async function bulkDelete() {
    setBulkBusy(true);
    setBulkError(null);
    try {
      const failures = await countBulkFailures(
        Array.from(selectedIds).map((id) => fetch(`/api/deals/${id}`, { method: "DELETE" })),
      );
      if (failures > 0) {
        setBulkError("Alguns negócios não puderam ser apagados.");
      }
      clearSelection();
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  // Move pra outra pipeline, sempre na primeira etapa dela — trocar de
  // funil E escolher uma etapa específica na mesma ação ficaria complexo
  // demais pro popover; dá pra reposicionar a etapa depois normalmente.
  async function applyBulkPipelineChange(newPipelineId: string) {
    const pipeline = pipelines.find((p) => p.id === newPipelineId);
    if (!pipeline || pipeline.stages.length === 0) return;
    setBulkBusy(true);
    setBulkError(null);
    try {
      const failures = await countBulkFailures(
        Array.from(selectedIds).map((id) =>
          fetch(`/api/deals/${id}/move`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pipelineId: newPipelineId, stageId: pipeline.stages[0].id }),
          }),
        ),
      );
      if (failures > 0) {
        setBulkError("Alguns negócios não puderam ser movidos de funil.");
      }
      clearSelection();
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  // Etapa dentro da mesma pipeline — pode falhar por negócio (etapa de
  // destino exige valor/tipo de crédito/previsão que aquele negócio ainda
  // não tem), por isso reporta como "alguns" em vez de tudo ou nada.
  async function applyBulkStageChange(newStageId: string) {
    setBulkBusy(true);
    setBulkError(null);
    try {
      const failures = await countBulkFailures(
        Array.from(selectedIds).map((id) =>
          fetch(`/api/deals/${id}/move`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stageId: newStageId }),
          }),
        ),
      );
      if (failures > 0) {
        setBulkError("Alguns negócios não puderam mudar de etapa (a etapa de destino pode exigir algum campo que falta preencher).");
      }
      clearSelection();
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  async function applyBulkOwnerChange(newOwnerId: string) {
    setBulkBusy(true);
    setBulkError(null);
    try {
      const failures = await countBulkFailures(
        Array.from(selectedIds).map((id) =>
          fetch(`/api/deals/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ownerId: newOwnerId }),
          }),
        ),
      );
      if (failures > 0) {
        setBulkError("Alguns negócios não puderam trocar de responsável.");
      }
      clearSelection();
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
            strokeWidth={2}
          />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Buscar negócio ou contato"
            className="field-input w-64 py-1.5 pl-8 text-sm"
          />
        </div>
        <FilterPopover active={hasFilters} onClear={clearFilters}>
          <div className="space-y-1">
            <label className="field-label">Status</label>
            <Select
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v as Deal["status"] | "");
                setPage(1);
              }}
              className="w-full py-1.5 text-sm"
              options={[
                { value: "OPEN", label: "Em andamento" },
                { value: "WON", label: "Ganhos" },
                { value: "LOST", label: "Perdidos" },
                { value: "", label: "Todos" },
              ]}
            />
          </div>
          <div className="space-y-1">
            <label className="field-label">Etapa</label>
            <Select
              value={stageFilter}
              onChange={(v) => {
                setStageFilter(v);
                setPage(1);
              }}
              className="w-full py-1.5 text-sm"
              options={[
                { value: "", label: "Todas as etapas" },
                ...stages.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
          </div>
          <div className="space-y-1">
            <label className="field-label">Responsável</label>
            <Select
              value={ownerFilter}
              onChange={(v) => {
                setOwnerFilter(v);
                setPage(1);
              }}
              className="w-full py-1.5 text-sm"
              options={[
                { value: "", label: "Todos os responsáveis" },
                ...members.map((m) => ({ value: m.id, label: m.active ? m.name : `${m.name} (inativo)` })),
              ]}
            />
          </div>
          <div className="space-y-1">
            <label className="field-label">Status do consultor</label>
            <Select
              value={ownerStatusFilter}
              onChange={(v) => {
                setOwnerStatusFilter(v as "" | "active" | "inactive");
                setPage(1);
              }}
              className="w-full py-1.5 text-sm"
              options={[
                { value: "", label: "Ativos e inativos" },
                { value: "active", label: "Somente ativos" },
                { value: "inactive", label: "Somente inativos" },
              ]}
            />
          </div>
          {jobTitleOptions.length > 0 && (
            <div className="space-y-1">
              <label className="field-label">Cargo</label>
              <Select
                value={jobTitleFilter}
                onChange={(v) => {
                  setJobTitleFilter(v);
                  setPage(1);
                }}
                className="w-full py-1.5 text-sm"
                options={[
                  { value: "", label: "Todos os cargos" },
                  ...jobTitleOptions.map((j) => ({ value: j, label: j })),
                ]}
              />
            </div>
          )}
          {originOptions.length > 0 && (
            <div className="space-y-1">
              <label className="field-label">Origem</label>
              <Select
                value={originFilter}
                onChange={(v) => {
                  setOriginFilter(v);
                  setPage(1);
                }}
                className="w-full py-1.5 text-sm"
                options={[
                  { value: "", label: "Todas as origens" },
                  ...originOptions.map((o) => ({ value: o, label: o })),
                ]}
              />
            </div>
          )}
          {statusFilter === "LOST" && lossReasons.length > 0 && (
            <div className="space-y-1">
              <label className="field-label">Motivo da perda</label>
              <Select
                value={lossReasonFilter}
                onChange={(v) => {
                  setLossReasonFilter(v);
                  setPage(1);
                }}
                className="w-full py-1.5 text-sm"
                options={[
                  { value: "", label: "Todos os motivos" },
                  ...lossReasons.map((r) => ({ value: r.id, label: r.label })),
                ]}
              />
            </div>
          )}
          <div className="space-y-1">
            <label className="field-label">Criado em</label>
            <DateRangeField
              from={dateFrom}
              to={dateTo}
              className="w-full py-1.5 text-sm"
              quickRanges={QUICK_RANGES}
              onSelect={(r) => {
                setDateFrom(r.from);
                setDateTo(r.to);
                setPage(1);
              }}
            />
          </div>
          <div className="space-y-1.5 border-t border-neutral-100 pt-2.5 dark:border-neutral-800">
            <label className="field-label">
              Concluído em <span className="font-normal normal-case text-neutral-400">(ganhos/perdidos)</span>
            </label>
            <DateRangeField
              from={closedFrom}
              to={closedTo}
              className="w-full py-1.5 text-sm"
              quickRanges={QUICK_RANGES}
              onSelect={applyClosedQuickRange}
            />
          </div>
        </FilterPopover>
        {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-neutral-400 dark:text-neutral-500" strokeWidth={2.5} />}
        {selectedIds.size > 0 && (
          <div className="ml-auto">
            <SelectionBar count={selectedIds.size} onClear={clearSelection}>
              {pipelines.filter((p) => p.id !== pipelineId).length > 0 && (
                <BulkActionPopover icon={GitBranch} label="Trocar de funil">
                  {(close) => (
                    <SelectPopoverBody
                      busy={bulkBusy}
                      options={pipelines.filter((p) => p.id !== pipelineId).map((p) => ({ value: p.id, label: p.name }))}
                      onApply={async (v) => { await applyBulkPipelineChange(v); close(); }}
                    />
                  )}
                </BulkActionPopover>
              )}
              <BulkActionPopover icon={Layers} label="Trocar de etapa">
                {(close) => (
                  <SelectPopoverBody
                    busy={bulkBusy}
                    options={stages.map((s) => ({ value: s.id, label: s.name }))}
                    onApply={async (v) => { await applyBulkStageChange(v); close(); }}
                  />
                )}
              </BulkActionPopover>
              <BulkActionPopover icon={User} label="Responsável">
                {(close) => (
                  <SelectPopoverBody
                    busy={bulkBusy}
                    options={members.filter((m) => m.active).map((m) => ({ value: m.id, label: m.name }))}
                    onApply={async (v) => { await applyBulkOwnerChange(v); close(); }}
                  />
                )}
              </BulkActionPopover>
              {canBulkMessage && (
                <button
                  type="button"
                  onClick={() => setBulkSendOpen(true)}
                  disabled={bulkBusy}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  <Send className="h-3.5 w-3.5" strokeWidth={2} />
                  Enviar mensagem em massa
                </button>
              )}
              {canBulkDelete && (
                <button
                  type="button"
                  onClick={() => setConfirmBulkDelete(true)}
                  disabled={bulkBusy}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                  Apagar
                </button>
              )}
            </SelectionBar>
          </div>
        )}
      </div>
      {bulkError && <p className="text-sm text-red-600 dark:text-red-400">{bulkError}</p>}

      <p className="text-xs text-neutral-400 dark:text-neutral-500">
        Ganhos: <span className="font-medium text-neutral-600 dark:text-neutral-300">{formatCurrency(sums.wonSum)}</span> · Perdidos:{" "}
        <span className="font-medium text-neutral-600 dark:text-neutral-300">{formatCurrency(sums.lostSum)}</span>
      </p>

      <div className="card overflow-x-auto">
        {totalCount === 0 ? (
          <EmptyState icon={Inbox} title="Nenhum negócio cadastrado" description="Crie o primeiro negócio para começar a preencher o funil." />
        ) : deals.length === 0 ? (
          <EmptyState icon={SearchX} title="Nenhum negócio encontrado" description="Ajuste a busca ou limpe os filtros." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 dark:border-neutral-800 text-left text-neutral-500 dark:text-neutral-400">
                <th className="px-3 py-2 font-medium">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    className="accent-neutral-900 dark:accent-white"
                    aria-label="Selecionar todos"
                  />
                </th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">Negócio</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">Cliente</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">Etapa</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">Status</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">Responsável</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">Próx. atividade</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">Data</th>
                <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Valor</th>
                <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Parado</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((deal) => (
                <tr
                  key={deal.id}
                  className="group border-b border-neutral-100 dark:border-neutral-800 last:border-0 hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
                >
                  <td className="px-3 py-1.5">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(deal.id)}
                      onClick={(e) => toggleSelect(deal.id, e.shiftKey)}
                      onChange={() => {}}
                      className={`accent-neutral-900 dark:accent-white ${
                        selectedIds.has(deal.id) ? "" : "opacity-0 group-hover:opacity-100"
                      }`}
                    />
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <Link
                      href={`/negocios/${deal.id}`}
                      className="flex items-center gap-1.5 font-medium text-neutral-900 dark:text-neutral-100 hover:underline"
                    >
                      {deal.hasUnreadWhatsApp && (
                        <span className="relative flex h-2 w-2 shrink-0" title="O lead respondeu">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-red-600" />
                        </span>
                      )}
                      <span>{deal.name}</span>
                      {deal.creditType && (
                        <span className="font-normal text-neutral-400 dark:text-neutral-500">· {deal.creditType}</span>
                      )}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <span className="text-neutral-800 dark:text-neutral-200">{deal.contact.name}</span>
                    {deal.contact.source && (
                      <span className="text-neutral-400 dark:text-neutral-500"> · {deal.contact.source}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: deal.stage.color ?? "#999" }} />
                      {deal.stage.name}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-neutral-500 dark:text-neutral-400">
                    {STATUS_LABELS[deal.status]}
                    {deal.status === "LOST" && (deal.lossReason?.label ?? deal.lostReason) && (
                      <span className="text-neutral-400 dark:text-neutral-500"> · {deal.lossReason?.label ?? deal.lostReason}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-neutral-500 dark:text-neutral-400">
                    <span className="flex items-center gap-1.5">
                      <Avatar name={deal.owner.name} src={deal.owner.photoUrl} size="xs" />
                      {deal.owner.name}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-neutral-500 dark:text-neutral-400">{deal.nextActivity ?? "—"}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-neutral-500 dark:text-neutral-400">
                    {new Date(deal.status === "OPEN" ? deal.createdAt : (deal.closedAt ?? deal.createdAt)).toLocaleDateString("pt-BR")}
                  </td>
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums whitespace-nowrap text-neutral-900 dark:text-neutral-100">
                    {formatCurrency(deal.value)}
                  </td>
                  <td className="px-3 py-1.5 text-right whitespace-nowrap text-neutral-500 dark:text-neutral-400">
                    {deal.status !== "OPEN" ? "—" : daysSince(deal.stageEnteredAt) === 0 ? "hoje" : `${daysSince(deal.stageEnteredAt)} dias`}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-neutral-200 dark:border-neutral-800">
                <td colSpan={8} className="px-3 py-2 text-right text-xs font-medium text-neutral-400 dark:text-neutral-500">
                  Total filtrado
                </td>
                <td className="px-3 py-2 text-right font-medium tabular-nums whitespace-nowrap text-neutral-900 dark:text-neutral-100">
                  {formatCurrency(sums.totalSum)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        itemLabel="negócios"
      />

      {confirmBulkDelete && (
        <ConfirmDialog
          title={`Apagar ${selectedIds.size} negócio${selectedIds.size === 1 ? "" : "s"}?`}
          description="Essa ação não pode ser desfeita."
          confirmLabel="Apagar"
          onClose={() => setConfirmBulkDelete(false)}
          onConfirm={async () => {
            await bulkDelete();
            setConfirmBulkDelete(false);
          }}
        />
      )}

      {bulkSendOpen && (
        <BulkSendMessageDialog
          dealIds={Array.from(selectedIds)}
          onClose={() => setBulkSendOpen(false)}
          onSent={() => {
            clearSelection();
            router.refresh();
          }}
          onCreateScript={handleCreateScript}
        />
      )}
    </div>
  );
}
