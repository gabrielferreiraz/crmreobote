"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { BarChart3, ChevronLeft, TrendingUp } from "lucide-react";
import { formatCurrency, formatCurrencyCompact, formatDuration } from "@/lib/format";

type PointStatus = "past" | "current" | "future";

type Point = {
  label: string;
  value: number;
  tooltipLabel?: string;
  status?: PointStatus;
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

function formatTrendCompact(format: TrendValueFormat, value: number): string {
  switch (format.type) {
    case "duration":
      return formatDuration(value * 1000);
    case "count":
      return value.toLocaleString("pt-BR");
    case "currency":
    default:
      if (value === 0) return "R$ 0";
      return formatCurrencyCompact(value);
  }
}

/** Arredonda o teto do eixo Y para um número "bonito" (1 / 2 / 2,5 / 5 / 10 × 10ⁿ) com folga visual no topo. */
function niceAxisMax(rawMax: number): number {
  if (rawMax <= 0) return 1;
  const padded = rawMax * 1.12;
  const magnitude = Math.pow(10, Math.floor(Math.log10(padded)));
  const normalized = padded / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * Interpolação cúbica monotônica em Bézier. Diferente de Catmull-Rom, não
 * ultrapassa máximos/mínimos entre dois períodos e nunca sugere valor negativo
 * onde os dados não têm um.
 */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  const widths = points.slice(0, -1).map((point, index) => points[index + 1].x - point.x);
  const slopes = widths.map((width, index) => (points[index + 1].y - points[index].y) / width);
  const tangents = new Array<number>(points.length);
  tangents[0] = slopes[0];
  tangents[tangents.length - 1] = slopes[slopes.length - 1];
  for (let index = 1; index < points.length - 1; index++) {
    const before = slopes[index - 1];
    const after = slopes[index];
    if (before === 0 || after === 0 || Math.sign(before) !== Math.sign(after)) {
      tangents[index] = 0;
      continue;
    }
    const previousWidth = widths[index - 1];
    const nextWidth = widths[index];
    const weightBefore = 2 * nextWidth + previousWidth;
    const weightAfter = nextWidth + 2 * previousWidth;
    tangents[index] = (weightBefore + weightAfter) / (weightBefore / before + weightAfter / after);
  }

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length - 1; index++) {
    const current = points[index];
    const next = points[index + 1];
    const width = widths[index];
    const cp1x = current.x + width / 3;
    const cp1y = Math.max(0, Math.min(100, current.y + (tangents[index] * width) / 3));
    const cp2x = next.x - width / 3;
    const cp2y = Math.max(0, Math.min(100, next.y - (tangents[index + 1] * width) / 3));
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${next.x} ${next.y}`;
  }
  return d;
}

/**
 * Gráfico de barras verticais interativo — ideal para comparar períodos
 * discretos (semanas, meses ou poucos dias) sem curvas enganosas caindo a zero
 * e com leitura imediata do valor compacto acima de cada barra.
 */
function TrendBarVisual({
  points: data,
  format,
  onPointClick,
  clickHint,
}: {
  points: Point[];
  format: TrendValueFormat;
  onPointClick?: (index: number) => void;
  clickHint?: string;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setDrawn(true);
      setHoverIndex(null);
      setSelectedIndex(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [data]);

  const rawMax = Math.max(0, ...data.map((d) => d.value));
  const axisMax = niceAxisMax(rawMax);
  const totalValue = data.reduce((sum, d) => sum + d.value, 0);
  const peakValue = rawMax;
  const activeIndex = hoverIndex ?? selectedIndex;
  const active = activeIndex !== null ? data[activeIndex] : null;
  const showAllInlineValues = data.length <= 7;
  const barGapClass = data.length > 14 ? "gap-1" : data.length > 8 ? "gap-1.5" : "gap-2 sm:gap-3";
  const xLabelStep = data.length > 12 ? Math.max(1, Math.ceil(data.length / 6)) : 1;

  const yTicks = [axisMax, axisMax / 2, 0];
  const activeCenterPct = activeIndex !== null && data.length > 0 ? ((activeIndex + 0.5) / data.length) * 100 : 50;

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (data.length === 0) return;
    const current = selectedIndex ?? hoverIndex ?? 0;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const next = Math.max(0, Math.min(data.length - 1, current + (e.key === "ArrowRight" ? 1 : -1)));
      setSelectedIndex(next);
      setHoverIndex(null);
    } else if ((e.key === "Enter" || e.key === " ") && onPointClick) {
      e.preventDefault();
      onPointClick(current);
    } else if (e.key === "Escape") {
      setSelectedIndex(null);
      setHoverIndex(null);
    }
  }

  return (
    <div
      role="group"
      tabIndex={0}
      aria-label="Evolução do valor ganho por período. Use as setas para navegar."
      onKeyDown={handleKeyDown}
      onMouseLeave={() => setHoverIndex(null)}
      className="select-none outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-neutral-950 rounded-md"
    >
      <div className="flex gap-2.5">
        {/* Eixo Y limpo */}
        <div className="flex h-44 w-14 shrink-0 flex-col justify-between py-0.5 text-right text-[10px] font-medium tabular-nums text-neutral-400 sm:w-16 dark:text-neutral-500">
          {yTicks.map((tick, idx) => (
            <span key={idx} className="leading-none">
              {formatTrendCompact(format, tick)}
            </span>
          ))}
        </div>

        {/* Área das barras */}
        <div className="relative flex-1">
          {/* Linhas de grade horizontais */}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex h-44 flex-col justify-between py-px">
            <div className="border-t border-dashed border-neutral-200/80 dark:border-neutral-800/80" />
            <div className="border-t border-dashed border-neutral-200/80 dark:border-neutral-800/80" />
            <div className="border-t border-neutral-200 dark:border-neutral-800" />
          </div>

          {/* Tooltip flutuante rico */}
          {active && (
            <div
              className="pointer-events-none absolute -top-2 z-20 -translate-x-1/2 -translate-y-full rounded-lg border border-neutral-800/80 bg-neutral-950/95 px-3 py-2 text-xs text-white shadow-xl backdrop-blur-sm transition-[left,opacity] duration-150 dark:border-neutral-200/20 dark:bg-white/95 dark:text-neutral-950"
              style={{ left: `clamp(6.5rem, ${activeCenterPct}%, calc(100% - 6.5rem))`, minWidth: "11.5rem" }}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="truncate font-medium capitalize opacity-75">{active.tooltipLabel ?? active.label}</p>
                {active.status === "future" ? (
                  <span className="shrink-0 rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-semibold dark:bg-neutral-900/10">
                    Futuro
                  </span>
                ) : active.value === peakValue && peakValue > 0 ? (
                  <span className="shrink-0 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-700">
                    Pico
                  </span>
                ) : active.status === "current" ? (
                  <span className="shrink-0 rounded bg-brand/25 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-200 dark:bg-brand/15 dark:text-brand">
                    Atual
                  </span>
                ) : null}
              </div>
              <p className="mt-1 whitespace-nowrap text-sm font-bold tabular-nums">
                {active.status === "future" && active.value === 0 ? "Ainda não iniciado" : formatTrendValue(format, active.value)}
              </p>
              {totalValue > 0 && active.value > 0 && (
                <p className="mt-0.5 text-[11px] tabular-nums opacity-70">
                  {Math.round((active.value / totalValue) * 100)}% do período exibido
                </p>
              )}
              {clickHint && active.status !== "future" && (
                <p className="mt-1.5 border-t border-white/15 pt-1 text-[10px] opacity-75 dark:border-neutral-900/10">
                  {clickHint}
                </p>
              )}
            </div>
          )}

          {/* Colunas */}
          <div className={`relative z-10 grid h-44 items-end ${barGapClass}`} style={{ gridTemplateColumns: `repeat(${Math.max(1, data.length)}, minmax(0, 1fr))` }}>
            {data.map((p, i) => {
              const isFuture = p.status === "future" && p.value === 0;
              const isCurrent = p.status === "current";
              const isPeak = p.value === peakValue && peakValue > 0;
              const isActive = activeIndex === i;
              const dimmed = activeIndex !== null && !isActive;
              const pctHeight = isFuture ? 0 : p.value > 0 ? Math.max(5, (p.value / axisMax) * 100) : 0;
              const showThisValue = showAllInlineValues || (data.length <= 12 && isPeak);

              return (
                <button
                  key={`${p.tooltipLabel ?? p.label}-${i}`}
                  type="button"
                  disabled={!onPointClick || isFuture}
                  onMouseEnter={() => setHoverIndex(i)}
                  onFocus={() => setSelectedIndex(i)}
                  onClick={() => {
                    if (onPointClick && !isFuture) onPointClick(i);
                  }}
                  className={`group relative flex h-full flex-col items-center justify-end outline-none ${
                    onPointClick && !isFuture ? "cursor-pointer" : "cursor-default"
                  }`}
                >
                  {/* Valor compacto limpo acima da barra */}
                  {showThisValue && (
                    <span
                      className={`mb-1.5 whitespace-nowrap text-[10px] font-semibold tabular-nums transition-opacity duration-150 sm:text-[11px] ${
                        isFuture
                          ? "text-neutral-300 dark:text-neutral-700"
                          : isPeak
                            ? "text-emerald-600 dark:text-emerald-400"
                            : isActive
                              ? "text-brand"
                              : "text-neutral-600 dark:text-neutral-300"
                      } ${dimmed ? "opacity-40" : "opacity-100"}`}
                    >
                      {isFuture ? "—" : formatTrendCompact(format, p.value)}
                    </span>
                  )}

                  {/* Barra propriamente dita */}
                  <div className="relative flex w-full max-w-[44px] flex-1 items-end">
                    {isFuture ? (
                      <div className="h-2.5 w-full rounded-t-md border border-b-0 border-dashed border-neutral-300/80 bg-neutral-100/40 dark:border-neutral-700/70 dark:bg-neutral-800/30" />
                    ) : p.value === 0 ? (
                      <div className="h-[3px] w-full rounded-full bg-neutral-200 dark:bg-neutral-800" />
                    ) : (
                      <div
                        className={`w-full rounded-t-md transition-all duration-500 ease-out ${
                          isPeak
                            ? "bg-gradient-to-t from-emerald-600 to-emerald-400 shadow-[0_4px_14px_-2px_rgba(16,185,129,0.4)] dark:from-emerald-600 dark:to-emerald-400"
                            : isActive
                              ? "bg-gradient-to-t from-brand to-indigo-400 shadow-[0_4px_12px_-2px_rgba(99,102,241,0.35)]"
                              : "bg-gradient-to-t from-brand/70 to-indigo-400/65 hover:from-brand hover:to-indigo-400 dark:from-brand/60 dark:to-indigo-400/55"
                        } ${isCurrent && !isPeak ? "ring-1 ring-brand/50 ring-inset" : ""} ${dimmed ? "opacity-45" : "opacity-100"}`}
                        style={{ height: drawn ? `${pctHeight}%` : "0%" }}
                      />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Rótulos do eixo X */}
          <div className={`mt-2 grid ${barGapClass}`} style={{ gridTemplateColumns: `repeat(${Math.max(1, data.length)}, minmax(0, 1fr))` }}>
            {data.map((p, i) => {
              const isFuture = p.status === "future" && p.value === 0;
              const isCurrent = p.status === "current";
              const isActive = activeIndex === i;
              const showLabel = xLabelStep === 1 || i % xLabelStep === 0 || i === data.length - 1;
              return (
                <div key={`x-${p.label}-${i}`} className="flex flex-col items-center overflow-visible">
                  {showLabel && (
                    <span
                      className={`whitespace-nowrap text-center text-[10px] capitalize transition-colors sm:text-[11px] ${
                        isActive
                          ? "font-semibold text-neutral-900 dark:text-neutral-100"
                          : isFuture
                            ? "text-neutral-300 dark:text-neutral-600"
                            : "text-neutral-500 dark:text-neutral-400"
                      }`}
                    >
                      {p.label.replace(/\.$/, "")}
                    </span>
                  )}
                  {isCurrent && xLabelStep === 1 && (
                    <span className="mt-0.5 text-[9px] font-medium text-brand">atual</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Área/linha em SVG puro, com eixo Y, crosshair suave e marcadores HTML
 * perfeitamente circulares (nunca distorcidos por preserveAspectRatio="none").
 */
function TrendChartVisual({
  points: data,
  format,
  showValueLabels = false,
  onPointClick,
  clickHint,
  heightClassName = "h-36",
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
  const chartId = useId().replace(/:/g, "");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [pointerX, setPointerX] = useState<number | null>(null);
  const [drawn, setDrawn] = useState(false);
  const gestureRef = useRef<{
    pointerId: number;
    pointerType: string;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setDrawn(true);
      setHoverIndex(null);
      setSelectedIndex(null);
      setPointerX(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [data]);

  const rawMax = Math.max(0, ...data.map((d) => d.value));
  const axisMax = niceAxisMax(rawMax);
  const points = data.map((d, i) => ({
    ...d,
    x: data.length > 1 ? (i / (data.length - 1)) * 100 : 50,
    y: 100 - (d.value / axisMax) * 92,
  }));
  const linePath = smoothPath(points);
  const areaPath = `${linePath} L 100 100 L 0 100 Z`;

  const MAX_LABELS = 6;
  const labelStep = Math.max(1, Math.ceil(points.length / MAX_LABELS));
  const axisLabels = points.filter((_, i) => i % labelStep === 0 || i === points.length - 1);
  const yTicks = [axisMax, axisMax / 2, 0];

  // Último ponto não-futuro para o marcador de destaque
  let lastElapsedIndex = points.length - 1;
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].status !== "future" || points[i].value > 0) {
      lastElapsedIndex = i;
      break;
    }
  }
  const lastElapsedPoint = points[lastElapsedIndex];

  function pointerPosition(clientX: number): { index: number; pctX: number } | null {
    if (!containerRef.current || points.length === 0) return null;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const pctX = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    let nearest = 0;
    let nearestDist = Infinity;
    points.forEach((p, i) => {
      const dist = Math.abs(p.x - pctX);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = i;
      }
    });
    return { index: nearest, pctX };
  }

  function updatePointer(clientX: number, persistSelection = false) {
    const position = pointerPosition(clientX);
    if (!position) return null;
    setPointerX(position.pctX);
    setHoverIndex(position.index);
    if (persistSelection) setSelectedIndex(position.index);
    return position.index;
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    updatePointer(e.clientX, e.pointerType !== "mouse");
    gestureRef.current = {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    if (gesture?.pointerId === e.pointerId) {
      if (Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY) > 7) gesture.moved = true;
      updatePointer(e.clientX, gesture.pointerType !== "mouse");
      return;
    }
    updatePointer(e.clientX);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    const index = updatePointer(e.clientX, e.pointerType !== "mouse");
    if (gesture?.pointerId === e.pointerId && !gesture.moved && index !== null && onPointClick) onPointClick(index);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    gestureRef.current = null;
  }

  function handlePointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    gestureRef.current = null;
    setPointerX(null);
    setHoverIndex(null);
  }

  function handlePointerLeave(e: React.PointerEvent<HTMLDivElement>) {
    if (gestureRef.current?.pointerId === e.pointerId) return;
    setPointerX(null);
    setHoverIndex(null);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (points.length === 0) return;
    const current = selectedIndex ?? hoverIndex ?? 0;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const direction = e.key === "ArrowRight" ? 1 : -1;
      const next = Math.max(0, Math.min(points.length - 1, current + direction));
      setSelectedIndex(next);
      setHoverIndex(null);
      setPointerX(points[next].x);
    } else if ((e.key === "Enter" || e.key === " ") && onPointClick) {
      e.preventDefault();
      onPointClick(current);
    } else if (e.key === "Escape") {
      setSelectedIndex(null);
      setHoverIndex(null);
      setPointerX(null);
    }
  }

  const activeIndex = hoverIndex ?? selectedIndex;
  const active = activeIndex !== null ? points[activeIndex] : null;
  const activeBreakdown = active?.breakdown?.filter((b) => b.value > 0) ?? [];
  const focusX = pointerX ?? active?.x ?? null;

  return (
    <div className="flex gap-2.5">
      {/* Eixo Y limpo */}
      <div className={`flex w-14 shrink-0 flex-col justify-between py-0.5 text-right text-[10px] font-medium tabular-nums text-neutral-400 sm:w-16 dark:text-neutral-500 ${heightClassName}`}>
        {yTicks.map((tick, idx) => (
          <span key={idx} className="leading-none">
            {formatTrendCompact(format, tick)}
          </span>
        ))}
      </div>

      <div className="min-w-0 flex-1">
        <div
          ref={containerRef}
          role="group"
          tabIndex={0}
          aria-label="Evolução do valor ganho. Use as setas para navegar entre os períodos."
          className={`relative w-full touch-pan-y select-none overflow-visible rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-neutral-950 ${heightClassName} ${
            onPointClick ? "cursor-pointer" : "cursor-ew-resize"
          }`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onPointerLeave={handlePointerLeave}
          onKeyDown={handleKeyDown}
        >
          {/* Grade de referência horizontal */}
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between py-px">
            <div className="border-t border-dashed border-neutral-200/80 dark:border-neutral-800/80" />
            <div className="border-t border-dashed border-neutral-200/80 dark:border-neutral-800/80" />
            <div className="border-t border-neutral-200 dark:border-neutral-800" />
          </div>

          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
            <defs>
              <linearGradient id={`${chartId}-fill`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity="0.24" />
                <stop offset="100%" stopColor="currentColor" stopOpacity="0.01" />
              </linearGradient>
              <clipPath id={`${chartId}-reveal`}>
                <rect x="0" y="0" width={drawn ? 100 : 0} height="100" className="transition-[width] duration-700 ease-out" />
              </clipPath>
            </defs>
            <g clipPath={`url(#${chartId}-reveal)`}>
              <path d={areaPath} fill={`url(#${chartId}-fill)`} stroke="none" className="text-brand dark:text-indigo-400" />
              <path
                d={linePath}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.25"
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-brand dark:text-indigo-400"
              />
            </g>
          </svg>

          {/* Ponto final sempre redondo (HTML, nunca distorcido pelo preserveAspectRatio="none") */}
          {lastElapsedPoint && !active && (
            <span
              className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand shadow-sm transition-opacity duration-300 dark:border-neutral-900 dark:bg-indigo-400"
              style={{ left: `${lastElapsedPoint.x}%`, top: `${lastElapsedPoint.y}%`, opacity: drawn ? 1 : 0 }}
            />
          )}

          {/* Valores compactos com fundo sutil para nunca colidir com a curva */}
          {showValueLabels &&
            points.length <= 8 &&
            axisLabels.map((p, i) => {
              const isFirst = p.x === 0;
              const isLast = p.x === 100;
              const isFuture = p.status === "future" && p.value === 0;
              return (
                <span
                  key={`${p.tooltipLabel ?? p.label}-${i}`}
                  className={`pointer-events-none absolute -translate-y-[calc(100%+6px)] whitespace-nowrap rounded bg-white/90 px-1 py-0.5 text-[10px] font-semibold tabular-nums backdrop-blur-[2px] transition-[color,opacity] duration-150 dark:bg-neutral-900/90 ${
                    isFuture
                      ? "text-neutral-300 dark:text-neutral-600"
                      : active && active.x === p.x
                        ? "text-brand dark:text-indigo-300"
                        : active
                          ? "text-neutral-400 opacity-35 dark:text-neutral-600"
                          : "text-neutral-600 dark:text-neutral-300"
                  } ${isFirst ? "left-0" : isLast ? "right-0" : "-translate-x-1/2"}`}
                  style={{ left: isFirst || isLast ? undefined : `${p.x}%`, top: `${p.y}%` }}
                >
                  {isFuture ? "—" : formatTrendCompact(format, p.value)}
                </span>
              );
            })}

          {/* Crosshair + Tooltip */}
          {active && focusX !== null && (
            <>
              <div
                className="pointer-events-none absolute inset-y-0 w-px bg-brand/45 transition-[left] duration-75 ease-out dark:bg-indigo-400/50"
                style={{ left: `${focusX}%` }}
              />
              <div
                className="pointer-events-none absolute left-0 h-px border-t border-dashed border-brand/25 transition-[top,width] duration-150 ease-out dark:border-indigo-400/25"
                style={{ top: `${active.y}%`, width: `${active.x}%` }}
              />
              <div
                className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/15 transition-[left,top] duration-150 ease-out dark:bg-indigo-400/20"
                style={{ left: `${active.x}%`, top: `${active.y}%` }}
              />
              <div
                className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand shadow-sm transition-[left,top] duration-150 ease-out dark:border-neutral-950 dark:bg-indigo-400"
                style={{ left: `${active.x}%`, top: `${active.y}%` }}
              />
              <div
                className={`pointer-events-none absolute -top-2 z-20 max-w-[calc(100%_-_1rem)] -translate-x-1/2 -translate-y-full rounded-lg border border-neutral-800/80 bg-neutral-950/95 px-3 py-2 text-xs font-medium text-white shadow-xl backdrop-blur-sm transition-[left,opacity] duration-150 dark:border-neutral-200/20 dark:bg-white/95 dark:text-neutral-950 ${
                  activeBreakdown.length > 0 || clickHint ? "w-52" : "w-max"
                }`}
                style={{ left: `clamp(6.5rem, ${active.x}%, calc(100% - 6.5rem))` }}
              >
                <p className="truncate capitalize opacity-70">{active.tooltipLabel ?? active.label}</p>
                <p className="mt-0.5 whitespace-nowrap text-sm font-bold tabular-nums">
                  {active.status === "future" && active.value === 0 ? "Ainda não iniciado" : formatValue(active.value)}
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
                {clickHint && active.status !== "future" && (
                  <p className="mt-1 border-t border-white/15 pt-1 text-[10px] opacity-75 dark:border-neutral-900/10">
                    {clickHint}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
        <div className="relative mt-2 h-4 text-[10px] text-neutral-500 capitalize sm:text-[11px] dark:text-neutral-400">
          {axisLabels.map((p, i) => {
            const isFirst = p.x === 0;
            const isLast = p.x === 100;
            return (
              <span
                key={`${p.tooltipLabel ?? p.label}-${i}`}
                className={`absolute whitespace-nowrap transition-[color,transform] duration-150 ${
                  active?.x === p.x ? "font-semibold text-neutral-900 dark:text-neutral-100" : ""
                } ${isFirst ? "left-0" : isLast ? "right-0" : "-translate-x-1/2"}`}
                style={isFirst || isLast ? undefined : { left: `${p.x}%` }}
              >
                {p.label}
              </span>
            );
          })}
        </div>
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

function dayKey(d: DailyPoint): string {
  return `${d.year}-${String(d.month + 1).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

function getTodayBrazilKey(): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const d = parts.find((p) => p.type === "day")?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    // fallback local
  }
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function resolveBucketStatus(days: DailyPoint[], today: string): PointStatus {
  if (days.length === 0) return "past";
  const firstKey = dayKey(days[0]);
  const lastKey = dayKey(days[days.length - 1]);
  if (firstKey > today) return "future";
  if (lastKey >= today) return "current";
  return "past";
}

function shortDate(d: DailyPoint): string {
  return new Date(Date.UTC(d.year, d.month, d.day)).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
}
function longDate(d: DailyPoint): string {
  return new Date(Date.UTC(d.year, d.month, d.day)).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", timeZone: "UTC" });
}

/** Um ponto por mês civil — soma de todo dia daquele mês presente em `daily`. */
function buildMonthPoints(daily: DailyPoint[], today: string): DrillPoint[] {
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
      status: resolveBucketStatus(days, today),
      _days: days,
    };
  });
}

/** Um ponto a cada 7 dias CONSECUTIVOS de `daily`, na ordem em que chegam. */
function buildWeekPoints(daily: DailyPoint[], today: string): DrillPoint[] {
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
      status: resolveBucketStatus(chunk, today),
      _days: chunk,
    });
  }
  return points;
}

/** Um ponto por dia — nível mais detalhado, sem mais drill (_days não se aplica). */
function buildDayPoints(daily: DailyPoint[], today: string): Point[] {
  return daily.map((d) => ({
    label: shortDate(d),
    tooltipLabel: new Date(Date.UTC(d.year, d.month, d.day)).toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      timeZone: "UTC",
    }),
    value: d.value,
    status: resolveBucketStatus([d], today),
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
 * Evolução com drill-down: mês → semana → dia, clicando num ponto ou barra —
 * sem round-trip ao servidor. Inclui faixa de resumo (pico e média dos períodos
 * já decorridos) e alternância rápida entre Barras (padrão mais legível para
 * períodos discretos) e Linha.
 */
export function DrillableTrendChart({
  dailyData,
  ytdDailyData,
  format = { type: "currency" },
}: {
  dailyData: DailyPoint[];
  /** Série acumulada do ano (01/01 até hoje) — usada quando o usuário escolhe a aba "Mês". */
  ytdDailyData?: DailyPoint[];
  format?: TrendValueFormat;
}) {
  const [stack, setStack] = useState<DrillView[]>(() => [{ level: pickInitialLevel(dailyData), data: dailyData, label: "Visão geral" }]);
  const [chartMode, setChartMode] = useState<"bar" | "line" | null>(null);

  const dailyKey = dailyData.map((d) => `${d.year}-${d.month}-${d.day}:${d.value}`).join(",");
  const prevKeyRef = useRef(dailyKey);
  useEffect(() => {
    if (prevKeyRef.current === dailyKey) return;
    prevKeyRef.current = dailyKey;
    setStack([{ level: pickInitialLevel(dailyData), data: dailyData, label: "Visão geral" }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyKey]);

  const today = useMemo(() => getTodayBrazilKey(), []);
  const view = stack[stack.length - 1];
  const points = useMemo(
    () =>
      view.level === "month"
        ? buildMonthPoints(view.data, today)
        : view.level === "week"
          ? buildWeekPoints(view.data, today)
          : buildDayPoints(view.data, today),
    [view, today],
  );

  const canDrill = view.level !== "day";
  const effectiveMode: "bar" | "line" = chartMode ?? (points.length <= 14 ? "bar" : "line");

  function selectGranularity(level: DrillLevel) {
    if (level === "month") {
      const monthSource = ytdDailyData && ytdDailyData.length > 0 ? ytdDailyData : dailyData;
      setStack([{ level: "month", data: monthSource, label: "No ano (Jan – atual)" }]);
    } else if (level === "week") {
      setStack([{ level: "week", data: dailyData, label: "Visão geral" }]);
    } else {
      setStack([{ level: "day", data: dailyData, label: "Visão geral" }]);
    }
  }

  // Estatísticas rápidas da visão atual (ignorando períodos futuros ainda zerados na média)
  const elapsedPoints = points.filter((p) => p.status !== "future" || p.value > 0);
  const totalInView = points.reduce((sum, p) => sum + p.value, 0);
  const avgInView = elapsedPoints.length > 0 ? totalInView / elapsedPoints.length : 0;
  const peakPoint = points.reduce<Point | null>((best, p) => (!best || p.value > best.value ? p : best), null);
  const unitShort = view.level === "month" ? "mês" : view.level === "week" ? "semana" : "dia";
  const clickHint =
    view.level === "month"
      ? "Clique para ver por semana →"
      : view.level === "week"
        ? "Clique para ver dia a dia →"
        : undefined;

  function handlePointClick(index: number) {
    if (!canDrill) return;
    const point = points[index] as DrillPoint;
    if (!point?._days?.length) return;
    const nextLevel: DrillLevel = view.level === "month" ? "week" : "day";
    setStack((s) => [...s, { level: nextLevel, data: point._days, label: point.tooltipLabel ?? point.label }]);
  }

  return (
    <div className="space-y-4">
      {/* Faixa de destaques objetivos do período em exibição */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-lg border border-neutral-100 bg-neutral-50/70 px-3 py-2 dark:border-neutral-800/80 dark:bg-neutral-900/50">
          <p className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
            Melhor {unitShort}
          </p>
          <p className="mt-0.5 truncate text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {peakPoint && peakPoint.value > 0 ? formatTrendCompact(format, peakPoint.value) : "—"}
          </p>
          {peakPoint && peakPoint.value > 0 && (
            <p className="truncate text-[10px] capitalize text-neutral-400 dark:text-neutral-500">
              {peakPoint.label.replace(/\.$/, "")}
            </p>
          )}
        </div>
        <div className="rounded-lg border border-neutral-100 bg-neutral-50/70 px-3 py-2 dark:border-neutral-800/80 dark:bg-neutral-900/50">
          <p className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
            Média por {unitShort}
          </p>
          <p className="mt-0.5 truncate text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
            {avgInView > 0 ? formatTrendCompact(format, avgInView) : "—"}
          </p>
          <p className="truncate text-[10px] text-neutral-400 dark:text-neutral-500">
            {view.level === "month" && stack.length === 1
              ? `Acumulado no ano · ${formatTrendCompact(format, totalInView)}`
              : `${elapsedPoints.length} ${elapsedPoints.length === 1 ? "período decorrido" : "períodos decorridos"}`}
          </p>
        </div>
      </div>

      {/* Cabeçalho: seletor Mês / Semana / Dia (ou Voltar no drill-down) + Barras / Linha */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex min-w-0 items-center gap-1.5">
          {stack.length > 1 ? (
            <>
              <button
                type="button"
                onClick={() => setStack((s) => s.slice(0, -1))}
                className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-neutral-200 bg-white px-2 py-1 font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
              >
                <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
                Voltar
              </button>
              <span className="min-w-0 truncate font-medium capitalize text-neutral-700 dark:text-neutral-200">
                {view.label}
              </span>
            </>
          ) : (
            <div
              className="inline-flex shrink-0 items-center rounded-lg border border-neutral-200/80 bg-neutral-100/70 p-0.5 dark:border-neutral-800 dark:bg-neutral-900"
              role="group"
              aria-label="Agrupamento do gráfico"
            >
              {(
                [
                  { id: "month", label: "Mês", title: "Ver de janeiro até o mês atual" },
                  { id: "week", label: "Semana", title: "Ver por semana no período" },
                  { id: "day", label: "Dia", title: "Ver dia a dia no período" },
                ] as { id: DrillLevel; label: string; title: string }[]
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => selectGranularity(opt.id)}
                  title={opt.title}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    view.level === opt.id
                      ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
                      : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="inline-flex shrink-0 items-center rounded-lg border border-neutral-200/80 bg-neutral-100/70 p-0.5 dark:border-neutral-800 dark:bg-neutral-900">
          <button
            type="button"
            onClick={() => setChartMode("bar")}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
              effectiveMode === "bar"
                ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
                : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
            }`}
            title="Visualizar em barras"
          >
            <BarChart3 className="h-3 w-3" strokeWidth={2} />
            Barras
          </button>
          <button
            type="button"
            onClick={() => setChartMode("line")}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
              effectiveMode === "line"
                ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
                : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
            }`}
            title="Visualizar em linha"
          >
            <TrendingUp className="h-3 w-3" strokeWidth={2} />
            Linha
          </button>
        </div>
      </div>

      {/* Gráfico propriamente dito */}
      <div className="pt-2">
        {effectiveMode === "bar" ? (
          <TrendBarVisual
            key={`bar-${view.level}-${stack.length}-${view.label}`}
            points={points}
            format={format}
            onPointClick={canDrill ? handlePointClick : undefined}
            clickHint={clickHint}
          />
        ) : (
          <TrendChartVisual
            key={`line-${view.level}-${stack.length}-${view.label}`}
            points={points}
            format={format}
            showValueLabels
            heightClassName="h-44"
            onPointClick={canDrill ? handlePointClick : undefined}
            clickHint={clickHint}
          />
        )}
      </div>
    </div>
  );
}
