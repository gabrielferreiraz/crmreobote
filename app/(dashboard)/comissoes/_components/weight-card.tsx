"use client";

import { useState } from "react";
import { formatCurrency, formatCurrencyCompact } from "@/lib/format";
import { formatMonthLong, formatMonthShort } from "@/lib/commissions/engine";
import type { CommissionWeight } from "@/lib/commissions/queries";

const formatPct = (value: number) => `${value.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`;

/**
 * A pergunta de dono, por mês da VENDA (últimos 6 meses, tocar numa barra
 * troca a frase):
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
    knowsRevenue ? (w.revenue > 0 ? ((w.revenue - w.commissionByCompany) / w.revenue) * 100 : 0) : w.sold > 0 ? (w.commission / w.sold) * 100 : 0;
  const max = Math.max(...weight.map(barValue), 0.01);
  const monthName = formatMonthLong(current.month).toLowerCase();

  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{knowsRevenue ? "Quanto fica para a corretora" : "Quanto a comissão pesa"}</h2>
        <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
          {current.sold === 0 ? (
            <>Nenhuma venda com comissão em {monthName}.</>
          ) : knowsRevenue && current.revenue > 0 ? (
            <>
              Nas vendas de {monthName}, as administradoras pagam <strong className="font-semibold">{formatCurrency(current.revenue)}</strong> para a
              corretora, <strong className="font-semibold">{formatCurrency(current.commissionByCompany)}</strong> vão para comissões e ficam{" "}
              <strong className="font-semibold text-neutral-900 dark:text-neutral-100">{formatCurrency(current.revenue - current.commissionByCompany)}</strong> (
              {formatPct(barValue(current))}).
            </>
          ) : knowsRevenue ? (
            <>
              Nas vendas de {monthName}, as comissões somam {formatCurrency(current.commission)}, mas as administradoras dessas vendas não têm cadastrado
              quanto pagam para a corretora.
            </>
          ) : (
            <>
              Nas vendas de {monthName}, a comissão é <strong className="font-semibold text-neutral-900 dark:text-neutral-100">{formatPct(barValue(current))}</strong> do
              valor vendido ({formatCurrency(current.commission)} de {formatCurrencyCompact(current.sold)}). Cadastre quanto cada administradora paga para ver
              quanto fica para a corretora.
            </>
          )}
        </p>
      </div>
      <div className="flex h-20 items-end gap-2">
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
              <span className={`w-full rounded-t-md ${i === selected ? "bg-brand" : "bg-brand/30"}`} style={{ height: `${Math.max(4, (value / max) * 100)}%` }} />
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
