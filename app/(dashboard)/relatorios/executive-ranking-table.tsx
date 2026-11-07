"use client";

import { useMemo, useState } from "react";
import { ArrowDown, Search } from "lucide-react";
import { formatCurrencyCompact } from "@/lib/format";
import type { ExecutiveRankingRow } from "@/lib/reports/executive-data";

type SortKey = "yearValue" | "recentValue" | "sales" | "activeMonths";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "yearValue", label: "Vendas no ano" },
  { key: "recentValue", label: "Últimos 3 meses" },
  { key: "sales", label: "Participações em ganhos" },
  { key: "activeMonths", label: "Meses com venda" },
];

export function ExecutiveRankingTable({
  rows,
  year,
  throughMonthLabel,
}: {
  rows: ExecutiveRankingRow[];
  year: number;
  throughMonthLabel: string;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("yearValue");

  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return rows
      .filter((row) => !normalized || `${row.name} ${row.team}`.toLocaleLowerCase("pt-BR").includes(normalized))
      .sort((a, b) => b[sort] - a[sort] || b.yearValue - a.yearValue || a.name.localeCompare(b.name, "pt-BR"));
  }, [query, rows, sort]);

  const maxYearValue = Math.max(1, ...visibleRows.map((row) => row.yearValue));

  return (
    <div>
      <div className="flex flex-col gap-2 border-b border-neutral-200 pb-4 dark:border-neutral-800 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-neutral-400" strokeWidth={2} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar vendedor ou equipe"
            className="field-input w-full pl-9 text-base"
          />
        </div>
        <label className="flex items-center gap-2 text-base text-neutral-500 lg:hidden dark:text-neutral-400">
          Ordenar por
          <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)} className="field-input min-w-44 text-base">
            {SORT_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      {visibleRows.length === 0 ? (
        <p className="py-10 text-center text-base text-neutral-500 dark:text-neutral-400">Nenhum vendedor encontrado.</p>
      ) : (
        <>
          <div className="hidden max-h-[560px] overflow-auto lg:block scrollbar-thin">
            <table className="w-full min-w-[860px] text-base">
              <thead className="sticky top-0 z-10 bg-white dark:bg-neutral-950">
                <tr className="border-b border-neutral-200 text-left text-sm text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                  <th className="px-3 py-4 font-medium">Vendedor</th>
                  <th className="px-3 py-4 font-medium">Equipe atual</th>
                  {SORT_OPTIONS.map((option) => (
                    <th key={option.key} className="px-3 py-4 text-right font-medium">
                      <button
                        type="button"
                        onClick={() => setSort(option.key)}
                        className={`ml-auto inline-flex items-center gap-1 hover:text-neutral-900 dark:hover:text-neutral-100 ${sort === option.key ? "text-neutral-900 dark:text-neutral-100" : ""}`}
                      >
                        {option.key === "yearValue" ? `Jan–${throughMonthLabel}/${String(year).slice(-2)}` : option.label}
                        {sort === option.key && <ArrowDown className="h-3.5 w-3.5" strokeWidth={2} />}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, index) => (
                  <tr key={row.id} className="group border-b border-neutral-100 transition-colors hover:bg-violet-50/50 last:border-0 dark:border-neutral-900 dark:hover:bg-violet-950/15">
                    <td className="px-3 py-4">
                      <div className="flex items-center gap-3">
                        <span className={`w-6 shrink-0 text-right text-sm font-semibold tabular-nums ${rankColor(index)}`}>{index + 1}</span>
                        <span className="font-medium text-neutral-900 transition-colors group-hover:text-violet-700 dark:text-neutral-100 dark:group-hover:text-violet-300">{row.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-4 text-neutral-500 dark:text-neutral-400">{row.team}</td>
                    <td className="px-3 py-4 text-right">
                      <div className="ml-auto flex max-w-56 items-center justify-end gap-2">
                        <span className="h-1.5 min-w-0 rounded-full bg-blue-500 transition-[width,filter] duration-300 group-hover:brightness-110" style={{ width: `${Math.max(3, (row.yearValue / maxYearValue) * 72)}px` }} />
                        <span className="min-w-24 font-medium tabular-nums text-neutral-900 dark:text-neutral-100">{formatCurrencyCompact(row.yearValue)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-4 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{formatCurrencyCompact(row.recentValue)}</td>
                    <td className="px-3 py-4 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{row.sales}</td>
                    <td className="px-3 py-4 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{row.activeMonths}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="divide-y divide-neutral-200 lg:hidden dark:divide-neutral-800">
            {visibleRows.map((row, index) => (
              <article key={row.id} className="-mx-2 px-2 py-4 transition-colors hover:bg-violet-50/50 dark:hover:bg-violet-950/15">
                <div className="flex items-start gap-3">
                  <span className={`mt-0.5 w-6 shrink-0 text-right text-sm font-semibold tabular-nums ${rankColor(index)}`}>{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-lg font-medium text-neutral-900 dark:text-neutral-100">{row.name}</h3>
                        <p className="truncate text-base text-neutral-500 dark:text-neutral-400">{row.team}</p>
                      </div>
                      <p className="shrink-0 text-lg font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{formatCurrencyCompact(row.yearValue)}</p>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-3">
                      <MobileMetric label="Últimos 3 meses" value={formatCurrencyCompact(row.recentValue)} />
                      <MobileMetric label="Participações" value={String(row.sales)} />
                      <MobileMetric label="Meses ativos" value={String(row.activeMonths)} />
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function MobileMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm text-neutral-400 dark:text-neutral-500">{label}</p>
      <p className="mt-0.5 text-base font-medium tabular-nums text-neutral-700 dark:text-neutral-300">{value}</p>
    </div>
  );
}

function rankColor(index: number): string {
  if (index === 0) return "text-amber-600 dark:text-amber-400";
  if (index === 1) return "text-blue-600 dark:text-blue-400";
  if (index === 2) return "text-orange-600 dark:text-orange-400";
  return "text-neutral-400 dark:text-neutral-500";
}
