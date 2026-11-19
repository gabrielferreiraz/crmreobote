"use client";

import { formatCurrency } from "@/lib/format";

type DayBucket = { year: number; month: number; day: number; value: number };

const DOW_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const DOW_FULL_LABELS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

/**
 * Distribuição de vendas por dia da semana (Dom–Sáb) a partir dos dados diários
 * já carregados, sem query extra. Destaca o dia campeão no cabeçalho e exibe a
 * participação percentual diretamente acima de cada coluna.
 */
export function WeekdayHeatmap({ dailyData }: { dailyData: DayBucket[] }) {
  const byDow = Array.from({ length: 7 }, () => ({ value: 0, days: 0 }));
  for (const b of dailyData) {
    if (b.value === 0) continue;
    const dow = new Date(Date.UTC(b.year, b.month, b.day)).getUTCDay();
    byDow[dow].value += b.value;
    byDow[dow].days += 1;
  }

  const maxValue = Math.max(...byDow.map((d) => d.value), 0);
  const totalValue = byDow.reduce((s, d) => s + d.value, 0);

  if (totalValue <= 0) {
    return (
      <p className="text-sm text-neutral-400 dark:text-neutral-500">
        Nenhum negócio ganho no período.
      </p>
    );
  }

  const bestIndex = byDow.findIndex((d) => d.value === maxValue);
  const bestPct = Math.round((maxValue / totalValue) * 100);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
          Por dia da semana
        </h4>
        {bestIndex >= 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand dark:bg-brand/15">
            Melhor dia: {DOW_LABELS[bestIndex]} · {bestPct}%
          </span>
        )}
      </div>

      <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {byDow.map((d, i) => {
          const intensity = maxValue > 0 ? d.value / maxValue : 0;
          const pct = Math.round((d.value / totalValue) * 100);
          const isBest = i === bestIndex && maxValue > 0;
          const hasValue = d.value > 0;
          const tooltipAlign = i === 0 ? "left-0" : i === 6 ? "right-0" : "left-1/2 -translate-x-1/2";

          return (
            <div key={i} className="group relative flex flex-col items-center gap-1.5">
              {/* Percentual direto acima da barra */}
              <span
                className={`text-[10px] font-semibold tabular-nums ${
                  isBest
                    ? "text-brand"
                    : hasValue
                      ? "text-neutral-600 dark:text-neutral-300"
                      : "text-neutral-300 dark:text-neutral-700"
                }`}
              >
                {hasValue ? `${pct}%` : "—"}
              </span>

              {/* Barra proporcional */}
              <div className="relative h-14 w-full overflow-hidden rounded-lg bg-neutral-100/90 dark:bg-neutral-800/70">
                {hasValue && (
                  <div
                    className={`absolute inset-x-0 bottom-0 rounded-lg transition-all duration-500 ${
                      isBest
                        ? "bg-gradient-to-t from-brand to-indigo-400 shadow-[0_2px_10px_-2px_rgba(99,102,241,0.45)]"
                        : "bg-brand/45 group-hover:bg-brand/65 dark:bg-brand/40 dark:group-hover:bg-brand/60"
                    }`}
                    style={{ height: `${Math.max(10, intensity * 100)}%` }}
                  />
                )}
              </div>

              {/* Tooltip rico no hover */}
              <div
                className={`pointer-events-none absolute -top-2 z-20 w-max min-w-[9.5rem] -translate-y-full rounded-lg border border-neutral-800/80 bg-neutral-950/95 px-2.5 py-2 text-left text-[11px] text-white opacity-0 shadow-xl backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-100 dark:border-neutral-200/20 dark:bg-white/95 dark:text-neutral-950 ${tooltipAlign}`}
              >
                <p className="font-medium opacity-75">{DOW_FULL_LABELS[i]}</p>
                <p className="mt-0.5 text-xs font-bold tabular-nums">
                  {hasValue ? formatCurrency(d.value) : "R$ 0,00"}
                </p>
                <p className="mt-0.5 text-[10px] opacity-70">
                  {d.days > 0 ? `${pct}% · ${d.days} ${d.days === 1 ? "dia com venda" : "dias com venda"}` : "Nenhum fechamento"}
                </p>
              </div>

              {/* Rótulo do dia */}
              <span
                className={`text-[11px] font-medium ${
                  isBest ? "font-semibold text-brand" : "text-neutral-500 dark:text-neutral-400"
                }`}
              >
                {DOW_LABELS[i]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
