"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, SearchX, Inbox, Trash2, GitBranch, Layers, User } from "lucide-react";
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
import { buildListQuickRanges } from "@/lib/date-ranges";
import { countBulkFailures } from "@/lib/bulk-fetch";
import type { Deal } from "./kanban-board";

const QUICK_RANGES = buildListQuickRanges();

type MemberOption = { id: string; name: string; active: boolean };
type Stage = { id: string; name: string; color: string | null };
type LossReasonOption = { id: string; label: string };
type PipelineOption = { id: string; name: string; stages: { id: string; name: string }[] };

const STATUS_LABELS: Record<Deal["status"], string> = {
  OPEN: "Em andamento",
  WON: "Ganho",
  LOST: "Perdido",
};

export function DealsList({
  deals,
  members,
  stages,
  pipelineId,
  pipelines,
  lossReasons,
  canBulkDelete,
}: {
  deals: Deal[];
  members: MemberOption[];
  stages: Stage[];
  pipelineId: string;
  pipelines: PipelineOption[];
  lossReasons: LossReasonOption[];
  canBulkDelete: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
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

  const activeByOwnerId = useMemo(() => new Map(members.map((m) => [m.id, m.active])), [members]);

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
  }

  function applyClosedQuickRange(range: { from: string; to: string }) {
    setClosedFrom(range.from);
    setClosedTo(range.to);
  }

  const filteredDeals = useMemo(() => {
    const term = search.trim().toLowerCase();
    const from = dateFrom ? brazilDateStringToUTC(dateFrom) : null;
    const to = dateTo ? brazilEndOfDayUTC(dateTo) : null;
    const closedFromDate = closedFrom ? brazilDateStringToUTC(closedFrom) : null;
    const closedToDate = closedTo ? brazilEndOfDayUTC(closedTo) : null;

    return deals.filter((d) => {
      if (term && !d.name.toLowerCase().includes(term) && !d.contact.name.toLowerCase().includes(term)) {
        return false;
      }
      if (statusFilter && d.status !== statusFilter) return false;
      if (ownerFilter && d.owner.id !== ownerFilter) return false;
      if (ownerStatusFilter) {
        const isActive = activeByOwnerId.get(d.owner.id) ?? true;
        if (ownerStatusFilter === "active" && !isActive) return false;
        if (ownerStatusFilter === "inactive" && isActive) return false;
      }
      if (stageFilter && d.stage.id !== stageFilter) return false;
      if (lossReasonFilter && d.lossReasonId !== lossReasonFilter) return false;
      if (jobTitleFilter && d.contact.jobTitle !== jobTitleFilter) return false;
      if (originFilter && d.contact.source !== originFilter) return false;
      const createdAt = new Date(d.createdAt);
      if (from && createdAt < from) return false;
      if (to && createdAt > to) return false;
      if (closedFromDate || closedToDate) {
        if (!d.closedAt) return false;
        const closedAt = new Date(d.closedAt);
        if (closedFromDate && closedAt < closedFromDate) return false;
        if (closedToDate && closedAt > closedToDate) return false;
      }
      return true;
    });
  }, [
    deals,
    search,
    statusFilter,
    ownerFilter,
    ownerStatusFilter,
    activeByOwnerId,
    stageFilter,
    lossReasonFilter,
    jobTitleFilter,
    originFilter,
    dateFrom,
    dateTo,
    closedFrom,
    closedTo,
  ]);

  const wonSum = useMemo(
    () => filteredDeals.filter((d) => d.status === "WON" && d.value != null).reduce((sum, d) => sum + d.value!, 0),
    [filteredDeals],
  );
  const lostSum = useMemo(
    () => filteredDeals.filter((d) => d.status === "LOST" && d.value != null).reduce((sum, d) => sum + d.value!, 0),
    [filteredDeals],
  );
  const totalFilteredValue = useMemo(
    () => filteredDeals.filter((d) => d.value != null).reduce((sum, d) => sum + d.value!, 0),
    [filteredDeals],
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const allFilteredSelected = filteredDeals.length > 0 && filteredDeals.every((d) => selectedIds.has(d.id));

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const d of filteredDeals) next.delete(d.id);
      } else {
        for (const d of filteredDeals) next.add(d.id);
      }
      return next;
    });
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
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
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar negócio ou contato"
            className="field-input w-64 py-1.5 pl-8 text-sm"
          />
        </div>
        <FilterPopover active={hasFilters} onClear={clearFilters}>
          <div className="space-y-1">
            <label className="field-label">Status</label>
            <Select
              value={statusFilter}
              onChange={(v) => setStatusFilter(v as Deal["status"] | "")}
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
              onChange={setStageFilter}
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
              onChange={setOwnerFilter}
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
              onChange={(v) => setOwnerStatusFilter(v as "" | "active" | "inactive")}
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
                onChange={setJobTitleFilter}
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
                onChange={setOriginFilter}
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
                onChange={setLossReasonFilter}
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
            <div className="flex flex-wrap gap-1">
              {QUICK_RANGES.map((q) => (
                <button
                  key={q.key}
                  type="button"
                  onClick={() => {
                    const r = q.range();
                    setDateFrom(r.from);
                    setDateTo(r.to);
                  }}
                  className="rounded-full border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-500 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                >
                  {q.label}
                </button>
              ))}
            </div>
            <DateRangeField
              from={dateFrom}
              to={dateTo}
              className="w-full py-1.5 text-sm"
              onSelect={(r) => {
                setDateFrom(r.from);
                setDateTo(r.to);
              }}
            />
          </div>
          <div className="space-y-1.5 border-t border-neutral-100 pt-2.5 dark:border-neutral-800">
            <label className="field-label">
              Concluído em <span className="font-normal normal-case text-neutral-400">(ganhos/perdidos)</span>
            </label>
            <div className="flex flex-wrap gap-1">
              {QUICK_RANGES.map((q) => (
                <button
                  key={q.key}
                  type="button"
                  onClick={() => applyClosedQuickRange(q.range())}
                  className="rounded-full border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-500 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                >
                  {q.label}
                </button>
              ))}
            </div>
            <DateRangeField
              from={closedFrom}
              to={closedTo}
              className="w-full py-1.5 text-sm"
              onSelect={(r) => {
                setClosedFrom(r.from);
                setClosedTo(r.to);
              }}
            />
          </div>
        </FilterPopover>
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
        Ganhos: <span className="font-medium text-neutral-600 dark:text-neutral-300">{formatCurrency(wonSum)}</span> · Perdidos:{" "}
        <span className="font-medium text-neutral-600 dark:text-neutral-300">{formatCurrency(lostSum)}</span>
      </p>

      <div className="card overflow-x-auto">
        {deals.length === 0 ? (
          <EmptyState icon={Inbox} title="Nenhum negócio cadastrado" description="Crie o primeiro negócio para começar a preencher o funil." />
        ) : filteredDeals.length === 0 ? (
          <EmptyState icon={SearchX} title="Nenhum negócio encontrado" description="Ajuste a busca ou limpe os filtros." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 dark:border-neutral-800 text-left text-neutral-500 dark:text-neutral-400">
                <th className="px-3 py-2 font-medium">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
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
              {filteredDeals.map((deal) => (
                <tr
                  key={deal.id}
                  className="group border-b border-neutral-100 dark:border-neutral-800 last:border-0 hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
                >
                  <td className="px-3 py-1.5">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(deal.id)}
                      onChange={() => toggleSelect(deal.id)}
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
                    {deal.status === "LOST" && deal.lossReason && (
                      <span className="text-neutral-400 dark:text-neutral-500"> · {deal.lossReason.label}</span>
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
                  {formatCurrency(totalFilteredValue)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

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
    </div>
  );
}
