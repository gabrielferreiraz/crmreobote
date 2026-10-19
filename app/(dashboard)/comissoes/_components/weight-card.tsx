"use client";

import { useState } from "react";
import { formatCurrency, formatCurrencyCompact } from "@/lib/format";
import { formatMonthLong, formatMonthShort } from "@/lib/commissions/engine";
import type { CommissionWeight } from "@/lib/commissions/queries";

const formatPct = (value: number) => `${value.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`;

/**
 * Resumo da corretora por mês da VENDA. Tocar numa barra troca os números:
 *  - quando as administradoras têm cadastrado quanto pagam: "as
 *    administradoras pagam R$ X para a corretora, R$ Y vão para comissões,
 *    ficam R$ Z" — a barra é o quanto FICA (%);
 *  - sem isso: quanto a comissão pesa sobre o valor vendido.
 */
export function WeightCard({ weight }: { weight: CommissionWeight }) {
  const [selected, setSelected] = useState(weight.length - 1);
  if (!weight.some((w) => w.sold > 0)) return null;

  const knowsRevenue = weight.some((w) => w.revenue > 0);
  const current = weight[selected];
  const barValue = (w: CommissionWeight[number]) =>
    Math.max(0, knowsRevenue ? (w.revenue > 0 ? ((w.revenue - w.commissionByCompanyKnown) / w.revenue) * 100 : 0) : w.sold > 0 ? (w.commission / w.sold) * 100 : 0);
  const max = Math.max(...weight.map(barValue), 0.01);
  const net = current.revenue - current.commissionByCompanyKnown;

  return (
    <section className="card flex min-h-80 flex-col rounded-lg p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {knowsRevenue ? "Resultado da corretora" : "Peso das comissões"}
        </h2>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">{formatMonthLong(current.month)}</span>
      </div>

      <div className="mt-4 grid grid-cols-3 divide-x divide-neutral-200 border-y border-neutral-200 py-3 dark:divide-neutral-800 dark:border-neutral-800">
        {knowsRevenue ? (
          <>
            <Metric label="Receita" value={formatCurrency(current.revenue)} />
            <Metric label="Comissões" value={formatCurrency(current.commissionByCompanyKnown)} />
            <Metric label="Saldo" value={formatCurrency(net)} strong />
          </>
        ) : (
          <>
            <Metric label="Vendido" value={formatCurrencyCompact(current.sold)} />
            <Metric label="Comissões" value={formatCurrency(current.commission)} />
            <Metric label="Peso" value={formatPct(barValue(current))} strong />
          </>
        )}
      </div>

      {current.salesWithoutRevenue > 0 && (
        <p className="mt-3 text-xs font-medium text-amber-700 dark:text-amber-300">
          {current.salesWithoutRevenue} {current.salesWithoutRevenue === 1 ? "venda sem taxa cadastrada" : "vendas sem taxa cadastrada"}
        </p>
      )}

      <div className="mt-auto flex h-28 items-end gap-2 pt-5">
        {weight.map((w, i) => {
          const value = barValue(w);
          return (
            <button
              key={w.month}
              type="button"
              onMouseEnter={() => setSelected(i)}
              onFocus={() => setSelected(i)}
              onClick={() => setSelected(i)}
              aria-label={`${formatMonthLong(w.month)}: ${formatPct(value)}`}
              className="flex h-full flex-1 flex-col items-center justify-end gap-1"
            >
              <span className={`w-full rounded-t-sm ${i === selected ? "bg-brand" : "bg-brand/25"}`} style={{ height: `${Math.max(4, (value / max) * 100)}%` }} />
              <span className={`text-[11px] ${i === selected ? "font-semibold text-neutral-900 dark:text-neutral-100" : "text-neutral-500"}`}>
                {formatMonthShort(w.month).split("/")[0]}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Metric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0 px-3 first:pl-0 last:pr-0">
      <p className="text-[11px] text-neutral-500 dark:text-neutral-400">{label}</p>
      <p className={`truncate text-sm tabular-nums text-neutral-900 dark:text-neutral-100 ${strong ? "font-semibold" : "font-medium"}`}>{value}</p>
    </div>
  );
}
