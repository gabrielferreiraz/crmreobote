"use client";

type DayBucket = { year: number; month: number; day: number; value: number };

const DOW_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/**
 * Heatmap de vendas por dia da semana — calcula a distribuição de valor ganho
 * por dia da semana (Dom-Sáb) a partir dos dados diários já disponíveis no
 * cliente, sem query extra. A intensidade da cor é relativa ao dia de maior
 * valor da semana.
 */
export function WeekdayHeatmap({ dailyData }: { dailyData: DayBucket[] }) {
  // Acumula valor e contagem por dia da semana (0=Dom, 6=Sáb)
  const byDow = Array.from({ length: 7 }, () => ({ value: 0, days: 0 }));
  for (const b of dailyData) {
    if (b.value === 0) continue;
    const dow = new Date(Date.UTC(b.year, b.month, b.day)).getUTCDay();
    byDow[dow].value += b.value;
    byDow[dow].days += 1;
  }

  const maxValue = Math.max(...byDow.map((d) => d.value), 1);
  const totalValue = byDow.reduce((s, d) => s + d.value, 0);
  const hasAnyData = totalValue > 0;

  if (!hasAnyData) {
    return (
      <p className="text-sm text-neutral-400 dark:text-neutral-500">
        Nenhum negócio ganho no período.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-7 gap-1.5">
        {byDow.map((d, i) => {
          const intensity = d.value / maxValue; // 0–1
          const pct = totalValue > 0 ? Math.round((d.value / totalValue) * 100) : 0;
          const isBest = d.value === maxValue && maxValue > 0;
          return (
            <div key={i} className="group relative flex flex-col items-center gap-1">
              {/* Barra de intensidade */}
              <div
                className="relative w-full overflow-hidden rounded-md transition-all duration-200"
                style={{ height: 56 }}
              >
                <div className="absolute inset-0 rounded-md bg-neutral-100 dark:bg-neutral-800" />
                <div
                  className={`absolute bottom-0 left-0 right-0 rounded-md transition-all duration-500 ${
                    isBest ? "bg-brand" : "bg-brand/40 dark:bg-brand/30"
                  }`}
                  style={{ height: `${Math.max(4, intensity * 100)}%` }}
                />
                {/* Tooltip ao hover */}
                <div className="pointer-events-none absolute inset-x-0 -top-1 -translate-y-full rounded-md bg-neutral-900 px-2 py-1 text-center text-[10px] text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:bg-neutral-700">
                  {d.days > 0
                    ? `${pct}% · ${d.days} dia${d.days === 1 ? "" : "s"}`
                    : "Nenhum fechamento"}
                </div>
              </div>
              {/* Rótulo */}
              <span
                className={`text-[11px] font-medium ${
                  isBest ? "text-brand dark:text-brand" : "text-neutral-400 dark:text-neutral-500"
                }`}
              >
                {DOW_LABELS[i]}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-neutral-400 dark:text-neutral-500">
        Altura proporcional ao valor total ganho por dia da semana no período — o dia em destaque concentrou mais fechamentos.
      </p>
    </div>
  );
}
