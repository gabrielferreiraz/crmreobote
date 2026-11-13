"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, BadgeDollarSign, ChevronRight, Download, Hash, RotateCcw, Search } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { CurrencyInput } from "@/components/currency-input";
import { Select } from "@/components/select";
import { formatCurrency } from "@/lib/format";

export type ClientRow = {
  key: string;
  contact: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    whatsapp: string | null;
    company: string | null;
    jobTitle: string | null;
    source: string | null;
  };
  owner: { id: string; name: string };
  deal: { id: string; name: string } | null;
  value: number | null;
  groupNumber: string | null;
  quotaNumber: string | null;
  quotaDigit: string | null;
  dealsCount: number;
  wonAt: string | null;
  badge: { label: string; color: string | null };
  href: string;
};

const PAGE = 200;
const digits = (value: string | null) => (value ?? "").replace(/\D/g, "");
type SortKey = "client" | "consultant" | "value" | "group" | "status";
type SortDirection = "asc" | "desc";

function SortHeader({
  label,
  column,
  sortKey,
  direction,
  onSort,
}: {
  label: string;
  column: SortKey;
  sortKey: SortKey;
  direction: SortDirection;
  onSort: (column: SortKey) => void;
}) {
  const active = sortKey === column;
  const Icon = active ? (direction === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;

  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      className={`inline-flex items-center gap-1.5 transition-colors hover:text-neutral-900 dark:hover:text-neutral-100 ${active ? "font-bold text-neutral-900 dark:text-neutral-100" : ""}`}
      aria-label={`Ordenar ${label} ${active && direction === "asc" ? "de Z a A" : "de A a Z"}`}
      title={active && direction === "asc" ? "Ordenado de A a Z. Clique para inverter" : "Ordenar de A a Z"}
    >
      {label}
      <Icon className={`h-3.5 w-3.5 ${active ? "text-brand" : "opacity-50"}`} strokeWidth={2.25} />
    </button>
  );
}

export function AdminClientsTable({ clients, canExport }: { clients: ClientRow[]; canExport: boolean }) {
  const [search, setSearch] = useState("");
  const [consultantId, setConsultantId] = useState("");
  const [groupNumber, setGroupNumber] = useState("");
  const [valueMin, setValueMin] = useState("");
  const [valueMax, setValueMax] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("client");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [visible, setVisible] = useState(PAGE);

  const consultants = useMemo(() => {
    const unique = new Map<string, string>();
    for (const client of clients) unique.set(client.owner.id, client.owner.name);
    return Array.from(unique, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [clients]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const termDigits = digits(term);
    const normalizedGroup = groupNumber.trim();
    const minimum = valueMin ? Number(valueMin) : null;
    const maximum = valueMax ? Number(valueMax) : null;

    return clients.filter((client) => {
      if (consultantId && client.owner.id !== consultantId) return false;
      if (normalizedGroup && client.groupNumber !== normalizedGroup) return false;
      if (minimum != null && (client.value == null || client.value < minimum)) return false;
      if (maximum != null && (client.value == null || client.value > maximum)) return false;
      if (!term) return true;

      return (
        client.contact.name.toLowerCase().includes(term) ||
        client.owner.name.toLowerCase().includes(term) ||
        (client.contact.company ?? "").toLowerCase().includes(term) ||
        (client.groupNumber ?? "").toLowerCase().includes(term) ||
        (client.quotaNumber ?? "").toLowerCase().includes(term) ||
        (client.deal?.name.toLowerCase().includes(term) ?? false) ||
        (client.contact.email ?? "").toLowerCase().includes(term) ||
        (termDigits.length >= 4 && (digits(client.contact.whatsapp).includes(termDigits) || digits(client.contact.phone).includes(termDigits)))
      );
    });
  }, [clients, consultantId, groupNumber, search, valueMax, valueMin]);

  const sorted = useMemo(() => {
    const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });
    const rows = [...filtered];

    rows.sort((left, right) => {
      if (sortKey === "value") {
        if (left.value == null && right.value == null) return 0;
        if (left.value == null) return 1;
        if (right.value == null) return -1;
        const result = left.value - right.value;
        return sortDirection === "asc" ? result : -result;
      }

      const leftValue = sortKey === "client"
        ? left.contact.name
        : sortKey === "consultant"
          ? left.owner.name
          : sortKey === "group"
            ? [left.groupNumber, left.quotaNumber].filter(Boolean).join(" ")
            : left.badge.label;
      const rightValue = sortKey === "client"
        ? right.contact.name
        : sortKey === "consultant"
          ? right.owner.name
          : sortKey === "group"
            ? [right.groupNumber, right.quotaNumber].filter(Boolean).join(" ")
            : right.badge.label;

      if (!leftValue && !rightValue) return 0;
      if (!leftValue) return 1;
      if (!rightValue) return -1;
      const result = collator.compare(leftValue, rightValue);
      return sortDirection === "asc" ? result : -result;
    });

    return rows;
  }, [filtered, sortDirection, sortKey]);

  const exportHref = useMemo(() => {
    const params = new URLSearchParams({ dealStatus: "WON" });
    if (search.trim()) params.set("q", search.trim());
    if (consultantId) params.set("dealOwnerId", consultantId);
    if (groupNumber.trim()) params.set("groupNumber", groupNumber.trim());
    if (valueMin) params.set("dealValueMin", valueMin);
    if (valueMax) params.set("dealValueMax", valueMax);
    return `/api/contacts/export?${params.toString()}`;
  }, [consultantId, groupNumber, search, valueMax, valueMin]);

  const hasFilters = Boolean(search || consultantId || groupNumber || valueMin || valueMax);
  const shown = sorted.slice(0, visible);

  function handleSort(column: SortKey) {
    if (sortKey === column) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else {
      setSortKey(column);
      setSortDirection("asc");
    }
    setVisible(PAGE);
  }

  function resetFilters() {
    setSearch("");
    setConsultantId("");
    setGroupNumber("");
    setValueMin("");
    setValueMax("");
    setVisible(PAGE);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 xl:flex-row xl:items-end">
        <div className="relative min-w-0 flex-1 xl:max-w-md">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-neutral-400" strokeWidth={2} />
          <input
            value={search}
            onChange={(event) => { setSearch(event.target.value); setVisible(PAGE); }}
            placeholder="Cliente, telefone, e-mail, grupo ou cota"
            className="field-input w-full py-2 pl-9 text-sm"
          />
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:flex xl:flex-1 xl:items-end">
          <label className="space-y-1 text-xs text-neutral-500 dark:text-neutral-400">
            <span>Consultor</span>
            <Select
              value={consultantId}
              onChange={(value) => { setConsultantId(value); setVisible(PAGE); }}
              ariaLabel="Filtrar por consultor"
              className="w-full py-2 text-sm xl:w-52"
              options={[
                { value: "", label: "Todos os consultores" },
                ...consultants.map((consultant) => ({ value: consultant.id, label: consultant.name })),
              ]}
            />
          </label>
          <label className="space-y-1 text-xs text-neutral-500 dark:text-neutral-400">
            <span>Grupo</span>
            <span className="relative block">
              <Hash className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-neutral-400" strokeWidth={2} />
              <input
                value={groupNumber}
                onChange={(event) => { setGroupNumber(event.target.value.replace(/\D/g, "")); setVisible(PAGE); }}
                inputMode="numeric"
                placeholder="Número"
                className="field-input w-full py-2 pl-9 text-sm xl:w-32"
              />
            </span>
          </label>
          <label className="space-y-1 text-xs text-neutral-500 dark:text-neutral-400">
            <span>Valor mínimo</span>
            <CurrencyInput value={valueMin} onChange={(value) => { setValueMin(value); setVisible(PAGE); }} className="py-2 text-sm xl:w-36" />
          </label>
          <label className="space-y-1 text-xs text-neutral-500 dark:text-neutral-400">
            <span>Valor máximo</span>
            <CurrencyInput value={valueMax} onChange={(value) => { setValueMax(value); setVisible(PAGE); }} className="py-2 text-sm xl:w-36" />
          </label>
        </div>

        <div className="flex items-center gap-2">
          {hasFilters && (
            <button type="button" onClick={resetFilters} className="icon-btn" title="Limpar filtros" aria-label="Limpar filtros">
              <RotateCcw className="h-4 w-4" strokeWidth={2} />
            </button>
          )}
          {canExport && (
            <a href={exportHref} className="btn-secondary ml-auto" title="Exportar os clientes filtrados">
              <Download className="h-4 w-4" strokeWidth={2} />
              Exportar
            </a>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between text-sm text-neutral-500 dark:text-neutral-400">
        <p><strong className="text-neutral-900 dark:text-neutral-100">{filtered.length}</strong> cliente{filtered.length === 1 ? "" : "s"}</p>
        {(valueMin || valueMax) && <p className="hidden sm:block">Faixa de valor aplicada</p>}
      </div>

      {filtered.length === 0 ? (
        <div className="card px-4 py-8 text-center text-sm text-neutral-400 dark:text-neutral-500">Nenhum cliente encontrado com esses filtros.</div>
      ) : (
        <div className="card overflow-x-auto">
          <div className="hidden min-w-[1160px] grid-cols-[minmax(250px,1.5fr)_minmax(180px,1fr)_minmax(180px,1fr)_150px_170px_160px_20px] gap-4 border-b border-neutral-100 px-4 py-2.5 text-xs font-medium tracking-wide text-neutral-400 uppercase sm:grid dark:border-neutral-800 dark:text-neutral-500">
            <SortHeader label="Cliente" column="client" sortKey={sortKey} direction={sortDirection} onSort={handleSort} />
            <span>Contato</span>
            <SortHeader label="Consultor" column="consultant" sortKey={sortKey} direction={sortDirection} onSort={handleSort} />
            <SortHeader label="Valor" column="value" sortKey={sortKey} direction={sortDirection} onSort={handleSort} />
            <SortHeader label="Grupo / cota" column="group" sortKey={sortKey} direction={sortDirection} onSort={handleSort} />
            <SortHeader label="Situação" column="status" sortKey={sortKey} direction={sortDirection} onSort={handleSort} />
            <span />
          </div>
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {shown.map((client) => (
              <Link
                key={client.key}
                href={client.href}
                className="grid grid-cols-1 gap-3 px-4 py-3 text-sm transition-colors hover:bg-neutral-50 sm:min-w-[1160px] sm:grid-cols-[minmax(250px,1.5fr)_minmax(180px,1fr)_minmax(180px,1fr)_150px_170px_160px_20px] sm:items-center dark:hover:bg-neutral-800/60"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-neutral-900 dark:text-neutral-100">{client.contact.name}</p>
                  <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                    {[client.contact.company, client.deal?.name, client.dealsCount > 1 ? `${client.dealsCount} vendas` : null].filter(Boolean).join(" · ") || "Cliente cadastrado"}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-neutral-700 dark:text-neutral-300">{client.contact.whatsapp || client.contact.phone || "—"}</p>
                  {client.contact.email && <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{client.contact.email}</p>}
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <Avatar name={client.owner.name} size="xs" />
                  <span className="truncate text-neutral-700 dark:text-neutral-300">{client.owner.name}</span>
                </div>
                <div className="flex items-center gap-1.5 font-semibold tabular-nums text-neutral-800 dark:text-neutral-200">
                  <BadgeDollarSign className="h-4 w-4 text-emerald-500 sm:hidden" strokeWidth={2} />
                  {client.value != null ? formatCurrency(client.value) : "—"}
                </div>
                <div className="min-w-0 text-neutral-700 dark:text-neutral-300">
                  {client.groupNumber ? (
                    <><p className="truncate font-medium">Grupo {client.groupNumber}</p>{client.quotaNumber && <p className="truncate text-xs text-neutral-500">Cota {client.quotaNumber}{client.quotaDigit ? `-${client.quotaDigit}` : ""}</p>}</>
                  ) : "—"}
                </div>
                <div>
                  <span className="inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium" style={{ borderColor: client.badge.color ?? "#999", color: client.badge.color ?? undefined }}>
                    {client.badge.label}
                  </span>
                  {client.wonAt && <p className="mt-1 text-[11px] text-neutral-400">{new Date(client.wonAt).toLocaleDateString("pt-BR", { timeZone: "America/Campo_Grande" })}</p>}
                </div>
                <ChevronRight className="hidden h-4 w-4 shrink-0 text-neutral-300 sm:block dark:text-neutral-600" strokeWidth={2} />
              </Link>
            ))}
          </div>
        </div>
      )}

      {filtered.length > shown.length && (
        <div className="flex justify-center">
          <button type="button" onClick={() => setVisible((count) => count + PAGE)} className="btn-secondary">
            Mostrar mais ({filtered.length - shown.length} restantes)
          </button>
        </div>
      )}
    </div>
  );
}
