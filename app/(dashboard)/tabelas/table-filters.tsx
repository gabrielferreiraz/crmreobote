"use client";

import { Search, X } from "lucide-react";
import { formatPercent } from "@/lib/servopa-tables/format";

export type TableFilterState = {
  segmento: string;
  grupo: string;
  prazo: string;
  taxa: string;
};

export function TableFilters({
  filters,
  terms,
  rates,
  onChange,
}: {
  filters: TableFilterState;
  terms: number[];
  rates: string[];
  onChange: (changes: Partial<TableFilterState>) => void;
}) {
  const hasFilters = Boolean(filters.segmento || filters.grupo || filters.prazo || filters.taxa);

  const segments = [
    { value: "", label: "Todos" },
    { value: "REAL_ESTATE", label: "Imóveis" },
    { value: "MOVABLE", label: "Móveis" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      <div className="relative min-w-0 flex-1 basis-full sm:basis-64">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
        <input
          id="grupo"
          inputMode="numeric"
          value={filters.grupo}
          onChange={(event) => onChange({ grupo: event.target.value.replace(/D/g, "") })}
          placeholder="Buscar pelo número do grupo"
          aria-label="Buscar pelo número do grupo"
          className="field-input h-10 pl-10 pr-9"
        />
        {filters.grupo && (
          <button type="button" onClick={() => onChange({ grupo: "" })} className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800" aria-label="Limpar busca">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      <div role="group" aria-label="Segmento" className="flex items-center gap-5">
        {segments.map((item) => {
          const active = filters.segmento === item.value;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => onChange({ segmento: item.value })}
              aria-pressed={active}
              className={`border-b-2 py-1.5 text-sm font-medium transition-colors ${active ? "border-brand text-neutral-900 dark:text-neutral-100" : "border-transparent text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"}`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <select id="prazo" aria-label="Prazo" value={filters.prazo} onChange={(event) => onChange({ prazo: event.target.value })} className="field-input field-select h-10 w-full sm:w-40">
        <option value="">Todos os prazos</option>
        {terms.map((months) => <option key={months} value={months}>{months} meses</option>)}
      </select>
      <select id="taxa" aria-label="Taxa de administração" value={filters.taxa} onChange={(event) => onChange({ taxa: event.target.value })} className="field-input field-select h-10 w-full sm:w-44">
        <option value="">Todas as taxas de ADM</option>
        {rates.map((rate) => <option key={rate} value={rate}>ADM {formatPercent(rate, { trim: true })}</option>)}
      </select>

      {hasFilters && (
        <button type="button" onClick={() => onChange({ segmento: "", grupo: "", prazo: "", taxa: "" })} className="btn-ghost h-10" title="Limpar filtros">
          <X className="h-4 w-4" aria-hidden="true" />
          Limpar filtros
        </button>
      )}
    </div>
  );
}
