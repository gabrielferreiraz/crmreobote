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

  return (
    <div className="card flex flex-wrap items-end gap-3 p-4">
      <div className="flex w-full items-center gap-2 border-b border-neutral-100 pb-3 text-sm font-semibold text-neutral-900 dark:border-neutral-800 dark:text-neutral-100">
        <Search className="h-4 w-4 text-neutral-400" aria-hidden="true" />
        Buscar tabela
      </div>
      <div className="w-full sm:w-56">
        <label htmlFor="grupo" className="field-label">Grupo</label>
        <div className="relative mt-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
          <input
            id="grupo"
            inputMode="numeric"
            value={filters.grupo}
            onChange={(event) => onChange({ grupo: event.target.value.replace(/\D/g, "") })}
            placeholder="Buscar grupo"
            className="field-input pl-9"
          />
        </div>
      </div>
      <div className="w-full sm:w-40">
        <label htmlFor="segmento" className="field-label">Segmento</label>
        <select id="segmento" value={filters.segmento} onChange={(event) => onChange({ segmento: event.target.value })} className="field-input field-select mt-1">
          <option value="">Todos</option>
          <option value="REAL_ESTATE">Imóvel</option>
          <option value="MOVABLE">Móvel</option>
        </select>
      </div>
      <div className="w-full sm:w-36">
        <label htmlFor="prazo" className="field-label">Prazo</label>
        <select id="prazo" value={filters.prazo} onChange={(event) => onChange({ prazo: event.target.value })} className="field-input field-select mt-1">
          <option value="">Todos</option>
          {terms.map((months) => <option key={months} value={months}>{months} meses</option>)}
        </select>
      </div>
      <div className="w-full sm:w-36">
        <label htmlFor="taxa" className="field-label">Taxa de ADM</label>
        <select id="taxa" value={filters.taxa} onChange={(event) => onChange({ taxa: event.target.value })} className="field-input field-select mt-1">
          <option value="">Todas</option>
          {rates.map((rate) => <option key={rate} value={rate}>{formatPercent(rate, { trim: true })}</option>)}
        </select>
      </div>
      {hasFilters && (
        <button type="button" onClick={() => onChange({ segmento: "", grupo: "", prazo: "", taxa: "" })} className="btn-ghost" title="Limpar filtros">
          <X className="h-4 w-4" aria-hidden="true" />
          Limpar
        </button>
      )}
    </div>
  );
}
