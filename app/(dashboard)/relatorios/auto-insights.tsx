"use client";

import { TrendingUp, TrendingDown, AlertTriangle, Star, Zap } from "lucide-react";
import { formatCurrency } from "@/lib/format";

type DayBucket = { year: number; month: number; day: number; value: number };

type Insight = {
  type: "positive" | "warning" | "neutral" | "star";
  text: string;
};

/**
 * Card de insights automáticos — deriva 3-5 observações relevantes dos dados
 * já calculados pelo servidor, sem query nova. Roda no navegador (client
 * component) pra manter a lógica de texto fora do server bundle.
 */
export function AutoInsights({
  wonCount,
  wonTotalValue,
  prevWonCount,
  prevWonTotalValue,
  winRate,
  dealsClosedRanking,
  slaOverallFirstTouchWithin1h,
  revenueTrendDaily,
}: {
  wonCount: number;
  wonTotalValue: number;
  prevWonCount: number | null;
  prevWonTotalValue: number | null;
  winRate: number;
  dealsClosedRanking: { name: string; primaryValue: string }[];
  slaOverallFirstTouchWithin1h: number | null;
  revenueTrendDaily: DayBucket[];
}) {
  const insights: Insight[] = [];

  // 1. Delta de faturamento vs período anterior
  if (prevWonTotalValue !== null && prevWonTotalValue > 0) {
    const delta = ((wonTotalValue - prevWonTotalValue) / prevWonTotalValue) * 100;
    if (Math.abs(delta) >= 2) {
      insights.push({
        type: delta >= 0 ? "positive" : "warning",
        text:
          delta >= 0
            ? `Faturamento ${Math.round(delta)}% acima do período anterior (${formatCurrency(prevWonTotalValue)})`
            : `Faturamento ${Math.round(Math.abs(delta))}% abaixo do período anterior (${formatCurrency(prevWonTotalValue)})`,
      });
    }
  } else if (prevWonCount !== null && prevWonCount > 0) {
    const delta = ((wonCount - prevWonCount) / prevWonCount) * 100;
    if (Math.abs(delta) >= 5) {
      insights.push({
        type: delta >= 0 ? "positive" : "warning",
        text:
          delta >= 0
            ? `${Math.round(delta)}% mais negócios fechados que no período anterior`
            : `${Math.round(Math.abs(delta))}% menos negócios fechados que no período anterior`,
      });
    }
  }

  // 2. Líder do ranking
  if (dealsClosedRanking.length > 0) {
    const leader = dealsClosedRanking[0];
    insights.push({
      type: "star",
      text: `${leader.name} liderou o período com ${leader.primaryValue}`,
    });
  }

  // 3. SLA de contato
  if (slaOverallFirstTouchWithin1h !== null) {
    if (slaOverallFirstTouchWithin1h >= 70) {
      insights.push({
        type: "positive",
        text: `${slaOverallFirstTouchWithin1h}% dos leads foram abordados em menos de 1 hora — excelente velocidade`,
      });
    } else if (slaOverallFirstTouchWithin1h < 40) {
      insights.push({
        type: "warning",
        text: `Apenas ${slaOverallFirstTouchWithin1h}% dos leads receberam contato em até 1 hora — atenção ao tempo de resposta`,
      });
    }
  }

  // 4. Melhor dia/semana — acha o bucket de dia com maior valor
  if (revenueTrendDaily.length > 0) {
    const best = revenueTrendDaily.reduce((a, b) => (b.value > a.value ? b : a), revenueTrendDaily[0]);
    if (best.value > 0) {
      const d = new Date(Date.UTC(best.year, best.month, best.day));
      const label = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" });
      insights.push({
        type: "neutral",
        text: `Melhor dia do período: ${label} com ${formatCurrency(best.value)}`,
      });
    }
  }

  // 5. Taxa de conversão
  if (winRate >= 60) {
    insights.push({ type: "positive", text: `Taxa de conversão de ${winRate}% — acima do esperado` });
  } else if (winRate > 0 && winRate < 20) {
    insights.push({ type: "warning", text: `Taxa de conversão de ${winRate}% — abaixo do ideal, vale revisar o funil` });
  }

  if (insights.length === 0) return null;

  return (
    <div className="card p-5">
      <p className="mb-3 text-[11px] font-semibold tracking-[0.14em] text-neutral-400 uppercase dark:text-neutral-500">
        Destaques do período
      </p>
      <ul className="space-y-2.5">
        {insights.map((ins, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <InsightIcon type={ins.type} />
            <p className="text-sm text-neutral-700 dark:text-neutral-300">{ins.text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function InsightIcon({ type }: { type: Insight["type"] }) {
  if (type === "positive")
    return <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" strokeWidth={2} />;
  if (type === "warning")
    return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" strokeWidth={2} />;
  if (type === "star")
    return <Star className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" strokeWidth={2} />;
  return <Zap className="mt-0.5 h-4 w-4 shrink-0 text-brand" strokeWidth={2} />;
}

// ─── Delta Badge ────────────────────────────────────────────────────────────

/**
 * Exibe "↑ 18%" ou "↓ 5%" ao lado de um valor de KPI.
 * delta = percentual já calculado (positivo = crescimento).
 * Só renderiza se |delta| >= 1.
 */
export function DeltaBadge({ current, previous }: { current: number; previous: number | null }) {
  if (previous === null || previous === 0) return null;
  const delta = ((current - previous) / previous) * 100;
  if (Math.abs(delta) < 1) return null;

  const up = delta > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
        up
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
          : "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400"
      }`}
    >
      {up ? <TrendingUp className="h-3 w-3" strokeWidth={2.5} /> : <TrendingDown className="h-3 w-3" strokeWidth={2.5} />}
      {Math.round(Math.abs(delta))}%
    </span>
  );
}
