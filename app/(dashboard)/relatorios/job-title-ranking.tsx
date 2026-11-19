"use client";

import { useMemo, useState } from "react";
import { BarChart3, TrendingUp, Wallet } from "lucide-react";
import { formatCurrency } from "@/lib/format";

type JobTitleRow = {
  label: string;
  won: number;
  lost: number;
  wonValue: number;
  winRate: number;
};

type SortBy = "value" | "conversion" | "volume";

const sortOptions: { id: SortBy; label: string; icon: typeof Wallet }[] = [
  { id: "value", label: "Valor", icon: Wallet },
  { id: "conversion", label: "Conversão", icon: TrendingUp },
  { id: "volume", label: "Volume", icon: BarChart3 },
];

export function JobTitleRanking({ rows }: { rows: JobTitleRow[] }) {
  const [sortBy, setSortBy] = useState<SortBy>("value");
  const [showAll, setShowAll] = useState(false);

  const sortedRows = useMemo(() => {
    const metric = (row: JobTitleRow) => {
      if (sortBy === "conversion") return row.winRate;
      if (sortBy === "volume") return row.won + row.lost;
      return row.wonValue;
    };
    return [...rows].sort((a, b) => metric(b) - metric(a) || b.won + b.lost - (a.won + a.lost) || a.label.localeCompare(b.label, "pt-BR"));
  }, [rows, sortBy]);

  const maxMetric = Math.max(1, ...sortedRows.map((row) => {
    if (sortBy === "conversion") return row.winRate;
    if (sortBy === "volume") return row.won + row.lost;
    return row.wonValue;
  }));
  const visibleRows = showAll ? sortedRows : sortedRows.slice(0, 8);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-3 dark:border-neutral-800">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          {rows.length} {rows.length === 1 ? "cargo" : "cargos"} no período
        </p>
        <div className="inline-flex max-w-full rounded-lg bg-neutral-100 p-1 dark:bg-neutral-900" role="group" aria-label="Ordenar ranking por">
          {sortOptions.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSortBy(id)}
              aria-pressed={sortBy === id}
              className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors duration-200 ${sortBy === id ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-white" : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"}`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
        {visibleRows.map((row, index) => {
          const total = row.won + row.lost;
          const metric = sortBy === "conversion" ? row.winRate : sortBy === "volume" ? total : row.wonValue;
          const barWidth = Math.max(metric > 0 ? 2 : 0, (metric / maxMetric) * 100);

          return (
            <div key={row.label} className="group py-4 transition-colors duration-200 hover:bg-neutral-50/70 dark:hover:bg-neutral-900/50">
              <div className="flex min-w-0 items-baseline justify-between gap-3">
                <div className="flex min-w-0 items-baseline gap-2.5">
                  <span className="w-6 shrink-0 text-right text-xs font-medium tabular-nums text-neutral-400 dark:text-neutral-500">{index + 1}</span>
                  <h3 className="truncate text-base font-semibold text-neutral-900 dark:text-neutral-100">{row.label}</h3>
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-neutral-800 dark:text-neutral-200">{formatCurrency(row.wonValue)}</span>
              </div>

              <div className="mt-2 pl-[2.125rem]">
                <div className="h-2 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800" aria-label={`${row.winRate}% de conversão`}>
                  <div
                    className={`h-full rounded-full transition-[width] duration-500 ease-out ${sortBy === "conversion" ? "bg-emerald-500" : sortBy === "volume" ? "bg-sky-500" : "bg-violet-500"}`}
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-neutral-500 dark:text-neutral-400">
                  <span><strong className="font-semibold text-emerald-600 dark:text-emerald-400">{row.won}</strong> ganhos</span>
                  <span><strong className="font-semibold text-neutral-700 dark:text-neutral-300">{row.lost}</strong> perdidos</span>
                  <span className="ml-auto font-medium tabular-nums text-neutral-700 dark:text-neutral-300">{row.winRate}% conversão</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {sortedRows.length > 8 && (
        <button
          type="button"
          onClick={() => setShowAll((current) => !current)}
          aria-expanded={showAll}
          className="mt-3 min-h-10 w-full rounded-lg text-sm font-semibold text-brand transition-colors hover:bg-brand/5"
        >
          {showAll ? "Mostrar menos" : `Ver todos os ${sortedRows.length} cargos`}
        </button>
      )}
    </div>
  );
}
