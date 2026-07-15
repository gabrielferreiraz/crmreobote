"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, SearchX, Inbox } from "lucide-react";
import { formatCurrency, daysSince } from "@/lib/format";
import { EmptyState } from "@/components/empty-state";
import { Avatar } from "@/components/avatar";
import { FilterPopover } from "@/components/filter-popover";
import { Select } from "@/components/select";
import { DateRangeField } from "@/components/date-range-calendar";
import { buildQuickRanges } from "@/lib/date-ranges";
import type { Deal } from "./kanban-board";

const QUICK_RANGES = buildQuickRanges();

type MemberOption = { id: string; name: string; active: boolean };
type Stage = { id: string; name: string; color: string | null };
type LossReasonOption = { id: string; label: string };

const STATUS_LABELS: Record<Deal["status"], string> = {
  OPEN: "Em andamento",
  WON: "Ganho",
  LOST: "Perdido",
};

export function DealsList({
  deals,
  members,
  stages,
  lossReasons,
}: {
  deals: Deal[];
  members: MemberOption[];
  stages: Stage[];
  lossReasons: LossReasonOption[];
}) {
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
    const from = dateFrom ? new Date(dateFrom) : null;
    const to = dateTo ? new Date(new Date(dateTo).getTime() + 24 * 60 * 60 * 1000) : null;
    const closedFromDate = closedFrom ? new Date(closedFrom) : null;
    const closedToDate = closedTo ? new Date(new Date(closedTo).getTime() + 24 * 60 * 60 * 1000) : null;

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
      if (to && createdAt >= to) return false;
      if (closedFromDate || closedToDate) {
        if (!d.closedAt) return false;
        const closedAt = new Date(d.closedAt);
        if (closedFromDate && closedAt < closedFromDate) return false;
        if (closedToDate && closedAt >= closedToDate) return false;
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
      </div>

      <div className="card overflow-x-auto">
        {deals.length === 0 ? (
          <EmptyState icon={Inbox} title="Nenhum negócio cadastrado" description="Crie o primeiro negócio para começar a preencher o funil." />
        ) : filteredDeals.length === 0 ? (
          <EmptyState icon={SearchX} title="Nenhum negócio encontrado" description="Ajuste a busca ou limpe os filtros." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 dark:border-neutral-800 text-left text-neutral-500 dark:text-neutral-400">
                <th className="px-4 py-2.5 font-medium">Negócio</th>
                <th className="px-4 py-2.5 font-medium">Cliente</th>
                <th className="px-4 py-2.5 font-medium">Etapa</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Responsável</th>
                <th className="px-4 py-2.5 font-medium">Próx. atividade</th>
                <th className="px-4 py-2.5 font-medium">Data</th>
                <th className="px-4 py-2.5 text-right font-medium">Valor</th>
                <th className="px-4 py-2.5 text-right font-medium">Parado</th>
              </tr>
            </thead>
            <tbody>
              {filteredDeals.map((deal) => (
                <tr
                  key={deal.id}
                  className="border-b border-neutral-100 dark:border-neutral-800 last:border-0 hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
                >
                  <td className="px-4 py-3">
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
                      <span className="truncate">{deal.name}</span>
                    </Link>
                    {deal.creditType && (
                      <p className="mt-0.5 text-xs text-neutral-400 dark:text-neutral-500">{deal.creditType}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-neutral-800 dark:text-neutral-200">{deal.contact.name}</p>
                    {deal.contact.source && (
                      <p className="mt-0.5 text-xs text-neutral-400 dark:text-neutral-500">{deal.contact.source}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: deal.stage.color ?? "#999" }} />
                      {deal.stage.name}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">
                    {STATUS_LABELS[deal.status]}
                    {deal.status === "LOST" && deal.lossReason && (
                      <p className="mt-0.5 text-xs text-neutral-400 dark:text-neutral-500">{deal.lossReason.label}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">
                    <span className="flex items-center gap-1.5">
                      <Avatar name={deal.owner.name} src={deal.owner.photoUrl} size="xs" />
                      {deal.owner.name}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">{deal.nextActivity ?? "—"}</td>
                  <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">
                    {new Date(deal.status === "OPEN" ? deal.createdAt : (deal.closedAt ?? deal.createdAt)).toLocaleDateString("pt-BR")}
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-neutral-900 dark:text-neutral-100">
                    {formatCurrency(deal.value)}
                  </td>
                  <td className="px-4 py-3 text-right text-neutral-500 dark:text-neutral-400">
                    {deal.status !== "OPEN" ? "—" : daysSince(deal.stageEnteredAt) === 0 ? "hoje" : `${daysSince(deal.stageEnteredAt)} dias`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
