"use client";

import { useRef, useState, useEffect } from "react";
import { ChevronLeft } from "lucide-react";
import { formatCurrency, formatDuration } from "@/lib/format";

type Point = {
  label: string;
  value: number;
  tooltipLabel?: string;
  /** Detalhamento opcional (ex.: por consultor) mostrado embaixo do total no balão do ponto. */
  breakdown?: { label: string; value: number }[];
};

/**
 * Serializável de propósito (nunca uma função) — este componente é "use
 * client" e recebe essa prop de Server Components (ver relatorios/page.tsx,
 * admin-reports-view.tsx); função não atravessa a fronteira RSC ("Functions
 * cannot be passed directly to Client Components").
 */
export type TrendValueFormat =
  | { type: "currency" }
  | { type: "duration" }
  | { type: "count"; singular: string; plural: string };

function formatTrendValue(format: TrendValueFormat, value: number): string {
  switch (format.type) {
    case "duration":
      return formatDuration(value * 1000);
    case "count":
      return `${value} ${value === 1 ? format.singular : format.plural}`;
    case "currency":
    default:
      return formatCurrency(value);
  }
}

/** Catmull-Rom → Bézier cúbica (tensão padrão) — curva suave passando por
 * todos os pontos, sem precisar de lib de gráfico. */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

/**
 * Área/linha em SVG puro, com crosshair que segue o ponteiro e encaixa no
 * ponto mais próximo — em vez de precisar acertar um alvo de poucos pixels
 * por cima de cada pontinho, a área inteira do gráfico já responde. Os
 * pontos/rótulos são renderizados como <span> HTML por cima (não dentro do
 * SVG) porque o viewBox usa preserveAspectRatio="none" pra esticar
 * livremente — um <circle> ali dentro viraria elipse distorcida; um <span>
 * posicionado em % do container real fica sempre redondo.
 *
 * Corpo visual compartilhado por TrendAreaChart (simples) e
 * DrillableTrendChart (com drill-down) abaixo — as duas só diferem em COMO
 * `points` é calculado, não em como é desenhado.
 */
function TrendChartVisual({
  points: data,
  format,
  showValueLabels = false,
  onPointClick,
  clickHint,
  heightClassName = "h-32",
}: {
  points: Point[];
  format: TrendValueFormat;
  showValueLabels?: boolean;
  /** Quando definido, clicar no ponto mais próximo do clique dispara isso — ver DrillableTrendChart. */
  onPointClick?: (index: number) => void;
  /** Linha extra e discreta no balão de hover (ex.: "Clique para ver os detalhes") — só faz sentido junto de onPointClick. */
  clickHint?: string;
  heightClassName?: string;
}) {
  const formatValue = (value: number) => formatTrendValue(format, value);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(frame);
  }, [data]);

  const max = Math.max(1, ...data.map((d) => d.value));
  const points = data.map((d, i) => ({
    ...d,
    x: data.length > 1 ? (i / (data.length - 1)) * 100 : 50,
    y: 100 - (d.value / max) * 92,
  }));
  const linePath = smoothPath(points);
  const areaPath = `${linePath} L 100 100 L 0 100 Z`;

  // Com muitos pontos (ex.: 31 dias), um rótulo por ponto vira uma fileira de
  // texto colada/sobreposta em tela estreita — mostra só um subconjunto bem
  // espaçado (sempre incluindo o primeiro e o último), como qualquer lib de
  // gráfico faz com o eixo X. Vale pra qualquer granularidade (mês/semana/
  // dia) — quem chama nunca precisa pensar nisso.
  const MAX_LABELS = 6;
  const labelStep = Math.max(1, Math.ceil(points.length / MAX_LABELS));
  const axisLabels = points.filter((_, i) => i % labelStep === 0 || i === points.length - 1);

  function nearestIndex(clientX: number): number | null {
    if (!containerRef.current || points.length === 0) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const pctX = ((clientX - rect.left) / rect.width) * 100;
    let nearest = 0;
    let nearestDist = Infinity;
    points.forEach((p, i) => {
      const dist = Math.abs(p.x - pctX);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = i;
      }
    });
    return nearest;
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    setHoverIndex(nearestIndex(e.clientX));
  }

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!onPointClick) return;
    const index = nearestIndex(e.clientX);
    if (index !== null) onPointClick(index);
  }

  const active = hoverIndex !== null ? points[hoverIndex] : null;
  const activeBreakdown = active?.breakdown?.filter((b) => b.value > 0) ?? [];
  // Perto das bordas do gráfico, um balão centrado no ponto vaza pra fora do
  // card — perto do início ele "nasce" grudado na esquerda do ponto, perto do
  // fim grudado na direita, só no meio fica centrado.
  const anchor = !active ? "center" : active.x < 15 ? "left" : active.x > 85 ? "right" : "center";

  return (
    <div>
      <div
        ref={containerRef}
        className={`relative w-full touch-none ${heightClassName} ${onPointClick ? "cursor-pointer" : "cursor-crosshair"}`}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverIndex(null)}
        onClick={handleClick}
      >
        {/* Grade de referência recessiva — 2 linhas horizontais, sem número
            do eixo (o card já é compacto demais pra caber uma coluna de
            rótulos sem brigar com o resto). */}
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between py-px">
          <div className="h-px bg-neutral-100 dark:bg-neutral-800/80" />
          <div className="h-px bg-neutral-100 dark:bg-neutral-800/80" />
          <div className="h-px bg-neutral-200 dark:bg-neutral-800" />
        </div>

        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
          <defs>
            <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
            <clipPath id="trend-reveal">
              <rect x="0" y="0" width={drawn ? 100 : 0} height="100" className="transition-[width] duration-[900ms] ease-out" />
            </clipPath>
          </defs>
          <g clipPath="url(#trend-reveal)">
            <path d={areaPath} fill="url(#trend-fill)" stroke="none" className="text-[#2a78d6] dark:text-[#3987e5]" />
            <path
              d={linePath}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-[#2a78d6] dark:text-[#3987e5]"
            />
          </g>
          {/* Ponto final sempre visível e um pouco maior — é o valor mais
              recente, a "manchete" da série. */}
          {points.length > 0 && (
            <circle
              cx={points[points.length - 1].x}
              cy={points[points.length - 1].y}
              r="1.6"
              className="fill-[#2a78d6] stroke-[#fcfcfb] dark:fill-[#3987e5] dark:stroke-neutral-900"
              strokeWidth="1"
              opacity={drawn ? 1 : 0}
              style={{ transition: "opacity 200ms ease-out 700ms" }}
            />
          )}
        </svg>

        {/* Valor de cada ponto rotulado, sempre visível (mesmo subconjunto de
            axisLabels abaixo, pra não lotar a tela com muitos pontos) — ver
            showValueLabels acima. Mesmo tratamento de borda que os rótulos
            do eixo X (left-0/right-0 nas pontas, senão o rótulo do 1º/último
            ponto vaza pra fora do card centralizado). */}
        {showValueLabels &&
          axisLabels.map((p, i) => {
            const isFirst = p.x === 0;
            const isLast = p.x === 100;
            return (
              <span
                key={i}
                className={`pointer-events-none absolute -translate-y-full whitespace-nowrap pb-1 text-[10px] font-medium tabular-nums text-neutral-500 dark:text-neutral-400 ${
                  isFirst ? "left-0" : isLast ? "right-0" : "-translate-x-1/2"
                }`}
                style={{ left: isFirst || isLast ? undefined : `${p.x}%`, top: `${p.y}%` }}
              >
                {formatValue(p.value)}
              </span>
            );
          })}

        {/* Crosshair — segue o ponteiro, encaixa no ponto mais próximo em vez
            de exigir mira precisa num alvo de poucos pixels. */}
        {active && (
          <>
            <div
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-neutral-300 dark:bg-neutral-600"
              style={{ left: `${active.x}%` }}
            />
            <div
              className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#2a78d6] ring-2 ring-[#fcfcfb] dark:bg-[#3987e5] dark:ring-neutral-900"
              style={{ left: `${active.x}%`, top: `${active.y}%` }}
            />
            <div
              className={`pointer-events-none absolute bottom-full z-10 mb-2 rounded-md bg-neutral-900 px-2.5 py-1.5 text-[11px] font-medium text-white shadow-lg dark:bg-white dark:text-neutral-900 ${
                activeBreakdown.length > 0 || clickHint ? "w-48" : "whitespace-nowrap"
              } ${anchor === "left" ? "left-0" : anchor === "right" ? "right-0" : "left-1/2 -translate-x-1/2"}`}
              style={{ left: anchor === "center" ? `${active.x}%` : undefined }}
            >
              <p className="whitespace-nowrap">
                <span className="capitalize opacity-70">{active.tooltipLabel ?? active.label}</span>
                <span className="mx-1 opacity-50">·</span>
                <span className="font-semibold">{formatValue(active.value)}</span>
              </p>
              {activeBreakdown.length > 0 && (
                <div className="mt-1 space-y-0.5 border-t border-white/15 pt-1 dark:border-neutral-900/10">
                  {activeBreakdown.slice(0, 5).map((b, bi) => (
                    <div key={bi} className="flex items-center justify-between gap-2 opacity-80">
                      <span className="min-w-0 truncate">{b.label}</span>
                      <span className="shrink-0 whitespace-nowrap tabular-nums">{formatValue(b.value)}</span>
                    </div>
                  ))}
                  {activeBreakdown.length > 5 && (
                    <p className="opacity-60">
                      +{activeBreakdown.length - 5} outro{activeBreakdown.length - 5 === 1 ? "" : "s"}
                    </p>
                  )}
                </div>
              )}
              {clickHint && <p className="mt-1 border-t border-white/15 pt-1 opacity-70 dark:border-neutral-900/10">{clickHint}</p>}
            </div>
          </>
        )}
      </div>
      <div className="relative mt-2 h-4 text-[11px] text-neutral-400 capitalize dark:text-neutral-500">
        {axisLabels.map((p, i) => {
          const isFirst = p.x === 0;
          const isLast = p.x === 100;
          return (
            <span
              key={i}
              className={`absolute whitespace-nowrap transition-colors ${hoverIndex !== null && points[hoverIndex]?.x === p.x ? "font-medium text-neutral-700 dark:text-neutral-300" : ""} ${
                isFirst ? "left-0" : isLast ? "right-0" : "-translate-x-1/2"
              }`}
              style={isFirst || isLast ? undefined : { left: `${p.x}%` }}
            >
              {p.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** Wrapper simples (sem drill-down) — comportamento e API inalterados, usado
 * onde a série já vem pronta na granularidade certa (ver admin-reports-view.tsx,
 * "Tempo ativo da equipe por dia" em relatorios/page.tsx). */
export function TrendAreaChart({
  data,
  format = { type: "currency" },
  showValueLabels = false,
}: {
  data: Point[];
  format?: TrendValueFormat;
  /** Ver documentação da mesma prop em TrendChartVisual acima. */
  showValueLabels?: boolean;
}) {
  return <TrendChartVisual points={data} format={format} showValueLabels={showValueLabels} />;
}

// ─── DrillableTrendChart ────────────────────────────────────────────────

/** Um dia (calendário de Brasília) e o total daquele dia — a granularidade
 * mais fina que o servidor manda (ver revenueTrendDaily em
 * lib/reports/commercial-data.ts); o componente agrega em mês/semana/dia
 * sozinho, sem round-trip nenhum ao servidor pra cada nível de zoom. */
export type DailyPoint = { year: number; month: number; day: number; value: number };

type DrillPoint = Point & { _days: DailyPoint[] };
type DrillLevel = "month" | "week" | "day";
type DrillView = { level: DrillLevel; data: DailyPoint[]; label: string };

function shortDate(d: DailyPoint): string {
  return new Date(Date.UTC(d.year, d.month, d.day)).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
}
function longDate(d: DailyPoint): string {
  return new Date(Date.UTC(d.year, d.month, d.day)).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", timeZone: "UTC" });
}

/** Um ponto por mês civil — soma de todo dia daquele mês presente em `daily`. */
function buildMonthPoints(daily: DailyPoint[]): DrillPoint[] {
  const groups = new Map<string, DailyPoint[]>();
  for (const d of daily) {
    const key = `${d.year}-${d.month}`;
    const arr = groups.get(key);
    if (arr) arr.push(d);
    else groups.set(key, [d]);
  }
  return Array.from(groups.values()).map((days) => {
    const { year, month } = days[0];
    const labelDate = new Date(Date.UTC(year, month, 1));
    return {
      label: labelDate.toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" }),
      tooltipLabel: labelDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }),
      value: days.reduce((sum, d) => sum + d.value, 0),
      _days: days,
    };
  });
}

/** Um ponto a cada 7 dias CONSECUTIVOS de `daily`, na ordem em que chegam —
 * não são semanas de calendário alinhadas (dom-sáb): isso deixaria a 1ª/
 * última "semana" de um mês parcial de um jeito estranho de rotular. Um
 * bloco fixo de 7 a partir do início do que está sendo detalhado (mês
 * inteiro, ou o período todo quando esse já é o nível inicial) é simples de
 * ler e nunca sobra pedaço de mês sem explicação. */
function buildWeekPoints(daily: DailyPoint[]): DrillPoint[] {
  const points: DrillPoint[] = [];
  for (let i = 0; i < daily.length; i += 7) {
    const chunk = daily.slice(i, i + 7);
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    const single = chunk.length === 1;
    points.push({
      label: single ? shortDate(first) : `${shortDate(first)}–${shortDate(last)}`,
      tooltipLabel: single ? longDate(first) : `${longDate(first)} a ${longDate(last)}`,
      value: chunk.reduce((sum, d) => sum + d.value, 0),
      _days: chunk,
    });
  }
  return points;
}

/** Um ponto por dia — nível mais detalhado, sem mais drill (_days não se aplica). */
function buildDayPoints(daily: DailyPoint[]): Point[] {
  return daily.map((d) => ({
    label: shortDate(d),
    tooltipLabel: new Date(Date.UTC(d.year, d.month, d.day)).toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      timeZone: "UTC",
    }),
    value: d.value,
  }));
}

/** Período curto já entra direto num nível mais detalhado — sem isso, filtrar
 * "Este mês" (uns 30 dias) abriria num gráfico mensal de 1 ponto só. */
function pickInitialLevel(daily: DailyPoint[]): DrillLevel {
  if (daily.length <= 14) return "day";
  if (daily.length <= 60) return "week";
  return "month";
}

/**
 * Evolução com drill-down: mês → semana → dia, clicando num ponto — sem
 * round-trip ao servidor a cada clique, já que o servidor manda a
 * granularidade mais fina possível (um valor por DIA do período inteiro, ver
 * revenueTrendDaily em lib/reports/commercial-data.ts) de uma vez só, e este
 * componente reagrega em mês/semana/dia sozinho, no navegador. Período já
 * curto (ver pickInitialLevel) abre direto num nível mais detalhado, sem
 * obrigar a "descer" por níveis que teriam 1 ponto só.
 */
export function DrillableTrendChart({
  dailyData,
  format = { type: "currency" },
}: {
  dailyData: DailyPoint[];
  format?: TrendValueFormat;
}) {
  const [stack, setStack] = useState<DrillView[]>(() => [{ level: pickInitialLevel(dailyData), data: dailyData, label: "Visão geral" }]);

  // Troca de filtro de período no resto do relatório muda `dailyData` debaixo
  // do componente — sem resetar a pilha, o usuário ficava "preso" olhando o
  // detalhe de um mês que o novo filtro nem cobre mais. Comparado pelo
  // conteúdo (não por identidade do array, que muda a cada render do
  // servidor mesmo com os mesmos valores).
  const dailyKey = dailyData.map((d) => `${d.year}-${d.month}-${d.day}:${d.value}`).join(",");
  const prevKeyRef = useRef(dailyKey);
  useEffect(() => {
    if (prevKeyRef.current === dailyKey) return;
    prevKeyRef.current = dailyKey;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStack([{ level: pickInitialLevel(dailyData), data: dailyData, label: "Visão geral" }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyKey]);

  const view = stack[stack.length - 1];
  const points =
    view.level === "month" ? buildMonthPoints(view.data) : view.level === "week" ? buildWeekPoints(view.data) : buildDayPoints(view.data);
  const canDrill = view.level !== "day";

  function handlePointClick(index: number) {
    if (!canDrill) return;
    const point = points[index] as DrillPoint;
    if (!point?._days?.length) return;
    const nextLevel: DrillLevel = view.level === "month" ? "week" : "day";
    setStack((s) => [...s, { level: nextLevel, data: point._days, label: point.tooltipLabel ?? point.label }]);
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
        <div className="flex min-w-0 items-center gap-1">
          {stack.length > 1 && (
            <button
              type="button"
              onClick={() => setStack((s) => s.slice(0, -1))}
              className="inline-flex shrink-0 items-center gap-0.5 rounded py-0.5 pr-1.5 font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
              Voltar
            </button>
          )}
          <span className="min-w-0 truncate font-medium capitalize text-neutral-700 dark:text-neutral-300">
            {stack.length > 1 ? view.label : "Visão geral"}
          </span>
        </div>
        {canDrill && <span className="shrink-0 text-neutral-400 dark:text-neutral-500">clique num ponto pra detalhar</span>}
      </div>
      <TrendChartVisual
        points={points}
        format={format}
        showValueLabels
        heightClassName="h-44"
        onPointClick={canDrill ? handlePointClick : undefined}
        clickHint={canDrill ? "Clique para ver os detalhes" : undefined}
      />
    </div>
  );
}
