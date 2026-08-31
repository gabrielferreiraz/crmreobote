"use client";

import { TrendingUp, TrendingDown, AlertTriangle, Star, Zap } from "lucide-react";
import { formatCurrency } from "@/lib/format";

type DayBucket = { year: number; month: number; day: number; value: number };

// Mesmo shape de `compareData` em lib/reports/commercial-data.ts — redefinido
// aqui (não importado) de propósito: este é um client component, e o mesmo
// padrão já vale pra DayBucket acima (server-only x client, sem acoplar o
// bundle do navegador a um módulo "use server" só por causa de um tipo).
type CompareData = {
  mode: "mirror" | "month" | "last3" | "year" | "custom";
  rangeLabel: string;
  wonCount: number;
  wonTotalValue: number;
  lostCount: number;
  closedCount: number;
  winRate: number;
  avgWonValue: number;
} | null;

type Insight = {
  type: "positive" | "warning" | "neutral" | "star";
  /** O número/valor que resume o insight num relance (ex.: "+10%",
   * "R$ 1,1 mi") — vira o elemento visual mais forte do tile; `text`
   * continua a frase completa, mas como legenda secundária, não mais o
   * único ponto de leitura. Pedido explícito: "visão mais objetiva do que
   * queremos mostrar" — antes cada insight era uma linha de texto corrido
   * do mesmo peso visual que as outras, sem nada pra guiar o olho pro que
   * importa primeiro. */
  highlight: string;
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
  compareData,
  winRate,
  dealsClosedRanking,
  slaOverallFirstTouchWithin1h,
  revenueTrendDaily,
}: {
  wonCount: number;
  wonTotalValue: number;
  /** null = "Comparar período" desligado (ver compare-period-filter.tsx) — sem isso, nenhum insight de delta aparece. */
  compareData: CompareData;
  winRate: number;
  dealsClosedRanking: { name: string; primaryValue: string }[];
  slaOverallFirstTouchWithin1h: number | null;
  revenueTrendDaily: DayBucket[];
}) {
  const insights: Insight[] = [];

  // 1. Delta de faturamento vs. o período de comparação escolhido (ver
  // compareData.rangeLabel — sempre a data exata, nunca só "período
  // anterior" genérico, pra nunca deixar dúvida sobre com o quê comparou).
  if (compareData && compareData.wonTotalValue > 0) {
    const delta = ((wonTotalValue - compareData.wonTotalValue) / compareData.wonTotalValue) * 100;
    if (Math.abs(delta) >= 2) {
      insights.push({
        type: delta >= 0 ? "positive" : "warning",
        highlight: `${delta >= 0 ? "+" : "-"}${Math.round(Math.abs(delta))}%`,
        text:
          delta >= 0
            ? `Faturamento acima de ${compareData.rangeLabel} (${formatCurrency(compareData.wonTotalValue)})`
            : `Faturamento abaixo de ${compareData.rangeLabel} (${formatCurrency(compareData.wonTotalValue)})`,
      });
    }
  } else if (compareData && compareData.wonCount > 0) {
    const delta = ((wonCount - compareData.wonCount) / compareData.wonCount) * 100;
    if (Math.abs(delta) >= 5) {
      insights.push({
        type: delta >= 0 ? "positive" : "warning",
        highlight: `${delta >= 0 ? "+" : "-"}${Math.round(Math.abs(delta))}%`,
        text:
          delta >= 0
            ? `Mais negócios fechados que em ${compareData.rangeLabel}`
            : `Menos negócios fechados que em ${compareData.rangeLabel}`,
      });
    }
  }

  // 2. Líder do ranking
  if (dealsClosedRanking.length > 0) {
    const leader = dealsClosedRanking[0];
    insights.push({
      type: "star",
      highlight: leader.primaryValue,
      text: `${leader.name} liderou o período`,
    });
  }

  // 3. SLA de contato
  if (slaOverallFirstTouchWithin1h !== null) {
    if (slaOverallFirstTouchWithin1h >= 70) {
      insights.push({
        type: "positive",
        highlight: `${slaOverallFirstTouchWithin1h}%`,
        text: "dos leads abordados em menos de 1 hora — excelente velocidade",
      });
    } else if (slaOverallFirstTouchWithin1h < 40) {
      insights.push({
        type: "warning",
        highlight: `${slaOverallFirstTouchWithin1h}%`,
        text: "dos leads receberam contato em até 1 hora — atenção ao tempo de resposta",
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
        highlight: formatCurrency(best.value),
        text: `Melhor dia do período: ${label}`,
      });
    }
  }

  // 5. Taxa de conversão
  if (winRate >= 60) {
    insights.push({ type: "positive", highlight: `${winRate}%`, text: "Taxa de conversão — acima do esperado" });
  } else if (winRate > 0 && winRate < 20) {
    insights.push({
      type: "warning",
      highlight: `${winRate}%`,
      text: "Taxa de conversão — abaixo do ideal, vale revisar o funil",
    });
  }

  if (insights.length === 0) return null;

  return (
    <div className="card p-5">
      <p className="mb-3 text-[11px] font-semibold tracking-[0.14em] text-neutral-400 uppercase dark:text-neutral-500">
        Destaques do período
      </p>
      {/* Grade de tiles (não mais lista de linhas do mesmo peso) — cada
          insight vira um bloco autocontido, colorido pelo próprio tipo
          (verde/âmbar/dourado/marca), com o número que resume ele em
          destaque e a frase completa como legenda por baixo. 2 colunas a
          partir de sm: com 3-5 insights (o normal aqui), 1 coluna larga
          ficava com muito espaço vazio ao lado do texto curto; par ímpar
          de itens simplesmente deixa o último ocupando a largura toda,
          sem problema nenhum no grid. */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {insights.map((ins, i) => (
          <InsightTile key={i} insight={ins} />
        ))}
      </div>
    </div>
  );
}

/** Paleta por tipo de insight — bg/border bem suaves (a cor não pode competir
 * com o número em destaque) e o próprio número/ícone na cor cheia. `star`
 * (líder do ranking) usa amarelo puro em vez do âmbar de `warning` — os dois
 * eram quase a mesma cor no design antigo (amber-400 vs amber-500), o que
 * misturava visualmente "atenção" com "conquista"; agora ficam claramente
 * distintos (dourado de troféu vs âmbar de alerta). */
const INSIGHT_PALETTE: Record<
  Insight["type"],
  { bg: string; border: string; iconBg: string; iconColor: string; valueColor: string }
> = {
  positive: {
    bg: "bg-emerald-50/60 dark:bg-emerald-500/[0.06]",
    border: "border-emerald-100 dark:border-emerald-500/15",
    iconBg: "bg-emerald-100 dark:bg-emerald-500/15",
    iconColor: "text-emerald-600 dark:text-emerald-400",
    valueColor: "text-emerald-700 dark:text-emerald-400",
  },
  warning: {
    bg: "bg-amber-50/60 dark:bg-amber-500/[0.06]",
    border: "border-amber-100 dark:border-amber-500/15",
    iconBg: "bg-amber-100 dark:bg-amber-500/15",
    iconColor: "text-amber-600 dark:text-amber-400",
    valueColor: "text-amber-700 dark:text-amber-400",
  },
  star: {
    bg: "bg-yellow-50/60 dark:bg-yellow-500/[0.06]",
    border: "border-yellow-100 dark:border-yellow-500/15",
    iconBg: "bg-yellow-100 dark:bg-yellow-500/15",
    iconColor: "text-yellow-600 dark:text-yellow-400",
    valueColor: "text-yellow-700 dark:text-yellow-400",
  },
  neutral: {
    bg: "bg-[var(--brand-subtle)]",
    border: "border-[color-mix(in_srgb,var(--brand)_18%,transparent)]",
    iconBg: "bg-[color-mix(in_srgb,var(--brand)_15%,transparent)]",
    iconColor: "text-brand",
    valueColor: "text-brand",
  },
};

function InsightTile({ insight }: { insight: Insight }) {
  const p = INSIGHT_PALETTE[insight.type];
  return (
    <div className={`flex items-start gap-3 rounded-xl border p-3 ${p.bg} ${p.border}`}>
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${p.iconBg}`}>
        <InsightIcon type={insight.type} className={p.iconColor} />
      </span>
      <div className="min-w-0">
        <p className={`text-base font-bold tabular-nums ${p.valueColor}`}>{insight.highlight}</p>
        <p className="mt-0.5 text-sm text-neutral-600 dark:text-neutral-400">{insight.text}</p>
      </div>
    </div>
  );
}

function InsightIcon({ type, className }: { type: Insight["type"]; className: string }) {
  if (type === "positive") return <TrendingUp className={`h-4 w-4 ${className}`} strokeWidth={2.25} />;
  if (type === "warning") return <AlertTriangle className={`h-4 w-4 ${className}`} strokeWidth={2.25} />;
  if (type === "star") return <Star className={`h-4 w-4 ${className}`} strokeWidth={2.25} />;
  return <Zap className={`h-4 w-4 ${className}`} strokeWidth={2.25} />;
}

// ─── Delta Badge ────────────────────────────────────────────────────────────

/**
 * Exibe "↑ 18%" ou "↓ 5%" ao lado de um valor de KPI, comparado com
 * `previous` (o mesmo número no período de comparação escolhido — ver
 * compareData em lib/reports/commercial-data.ts). Só renderiza se |delta| >= 1.
 *
 * A SETA sempre mostra a direção real do número (subiu/desceu) — a COR é
 * quem muda de sentido conforme `invert`: pra a maioria das métricas (Total
 * ganho, Ganhos, Contato em <1h...) subir é bom, verde; mas pra métricas
 * onde subir é RUIM (Perdidos, motivo de perda, tempo médio de resposta —
 * "menos é melhor"), `invert` passa a mostrar verde quando desce e vermelho
 * quando sobe. Sem isso, "Perdidos subiu 20%" apareceria em verde como se
 * fosse uma boa notícia.
 */
export function DeltaBadge({
  current,
  previous,
  compareLabel,
  invert = false,
}: {
  current: number;
  previous: number | null;
  /** Rótulo do período de comparação (ex.: "01/07 – 31/07/2026") — vira o
   * title (tooltip nativo) do badge, pra nunca deixar ambíguo COM O QUÊ o %
   * está comparando. Só definido quando `previous` também está (ver
   * compareData em lib/reports/commercial-data.ts — os dois vêm juntos). */
  compareLabel?: string;
  /** true pra métricas onde subir é RUIM (ver comentário acima) — inverte só a cor, nunca a seta. */
  invert?: boolean;
}) {
  if (previous === null || previous === 0) return null;
  const delta = ((current - previous) / previous) * 100;
  if (Math.abs(delta) < 1) return null;

  const up = delta > 0;
  const good = invert ? !up : up;
  return (
    <span
      title={compareLabel ? `Comparando com o período selecionado: ${compareLabel}` : undefined}
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
        good
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
          : "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400"
      }`}
    >
      {up ? <TrendingUp className="h-3 w-3" strokeWidth={2.5} /> : <TrendingDown className="h-3 w-3" strokeWidth={2.5} />}
      {Math.round(Math.abs(delta))}%
    </span>
  );
}
