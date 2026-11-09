"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatCurrencyCompact } from "@/lib/format";
import type { ExecutiveReportData } from "@/lib/reports/executive-data";
import {
  calculatePercentageChange,
  EXECUTIVE_MONTHS_LONG,
  EXECUTIVE_MONTHS_SHORT,
  formatExecutiveCurrency,
  formatSignedPercentage,
} from "@/lib/reports/executive-utils";
const HISTORICAL_COLORS = ["#737373", "#8b5cf6", "#06b6d4", "#10b981", "#eab308", "#f43f5e"];

const WIDTH = 960;
const HEIGHT = 340;
const LEFT = 72;
const RIGHT = 20;
const TOP = 18;
const BOTTOM = 44;
const PLOT_HEIGHT = HEIGHT - TOP - BOTTOM;
const MOBILE_WIDTH = 360;
const MOBILE_HEIGHT = 260;
const MOBILE_LEFT = 8;
const MOBILE_RIGHT = 8;
const MOBILE_TOP = 16;
const MOBILE_BOTTOM = 34;
const MOBILE_PLOT_WIDTH = MOBILE_WIDTH - MOBILE_LEFT - MOBILE_RIGHT;
const MOBILE_PLOT_HEIGHT = MOBILE_HEIGHT - MOBILE_TOP - MOBILE_BOTTOM;

type HoverState = {
  month: number;
  seriesIndex: number;
};

type GestureStart = {
  x: number;
  y: number;
};

export function ExecutiveSalesChart({
  series,
  exactValues,
}: {
  series: ExecutiveReportData["yearlySeries"];
  exactValues: boolean;
}) {
  const [hover, setHover] = useState<HoverState | null>(null);
  const [focusedSeries, setFocusedSeries] = useState<number | null>(null);
  const [selectedSeries, setSelectedSeries] = useState<number | null>(null);
  const [mobileMonth, setMobileMonth] = useState(() => findLastMonthWithValue(series));
  const [mobileDirection, setMobileDirection] = useState<1 | -1>(1);
  const [dragMonth, setDragMonth] = useState<number | null>(null);
  const gestureStart = useRef<GestureStart | null>(null);
  const desktopChartRef = useRef<HTMLDivElement | null>(null);
  const [desktopWidth, setDesktopWidth] = useState(WIDTH);
  const desktopPlotWidth = desktopWidth - LEFT - RIGHT;
  const lastMonth = findLastMonthWithValue(series);
  const monthDivisor = Math.max(1, lastMonth);
  const maxValue = useMemo(
    () => niceMaximum(Math.max(1, ...series.flatMap((year) => year.values.map((value) => value ?? 0)))),
    [series],
  );
  const yTicks = useMemo(
    () => Array.from({ length: 5 }, (_, index) => (maxValue / 4) * index).reverse(),
    [maxValue],
  );

  useEffect(() => {
    const chart = desktopChartRef.current;
    if (!chart) return;

    const updateWidth = () => setDesktopWidth(Math.max(760, Math.round(chart.getBoundingClientRect().width)));
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(chart);
    return () => observer.disconnect();
  }, []);

  const point = (month: number, value: number) => ({
    x: lastMonth === 0 ? LEFT + desktopPlotWidth / 2 : LEFT + (month / monthDivisor) * desktopPlotWidth,
    y: TOP + (1 - value / maxValue) * PLOT_HEIGHT,
  });
  const mobilePoint = (month: number, value: number) => ({
    x: lastMonth === 0 ? MOBILE_LEFT + MOBILE_PLOT_WIDTH / 2 : MOBILE_LEFT + (month / monthDivisor) * MOBILE_PLOT_WIDTH,
    y: MOBILE_TOP + (1 - value / maxValue) * MOBILE_PLOT_HEIGHT,
  });

  const selectAtPointer = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - bounds.left) / bounds.width) * desktopWidth;
    const svgY = ((event.clientY - bounds.top) / bounds.height) * HEIGHT;
    if (svgX < LEFT || svgX > desktopWidth - RIGHT || svgY < TOP || svgY > TOP + PLOT_HEIGHT) {
      setHover(null);
      setFocusedSeries(null);
      return;
    }
    const month = lastMonth === 0
      ? 0
      : clamp(Math.round(((svgX - LEFT) / desktopPlotWidth) * lastMonth), 0, lastMonth);
    const nearestSeries = series.reduce(
      (nearest, year, index) => {
        const value = year.values[month];
        if (value === null) return nearest;
        const distance = Math.abs(point(month, value).y - svgY);
        return distance < nearest.distance ? { index, distance } : nearest;
      },
      { index: series.length - 1, distance: Number.POSITIVE_INFINITY },
    );
    if (!Number.isFinite(nearestSeries.distance)) {
      setHover(null);
      setFocusedSeries(null);
      return;
    }

    setHover({ month, seriesIndex: nearestSeries.index });
    setFocusedSeries(nearestSeries.index);
  };

  const selectMonth = (month: number) => {
    const boundedMonth = clamp(month, 0, lastMonth);
    const seriesIndex = findLatestSeriesWithValue(series, boundedMonth);
    setHover({ month: boundedMonth, seriesIndex });
    setFocusedSeries(seriesIndex);
  };

  const monthAtMobilePointer = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - bounds.left) / bounds.width) * MOBILE_WIDTH;
    if (lastMonth === 0) return 0;
    return clamp(Math.round(((svgX - MOBILE_LEFT) / MOBILE_PLOT_WIDTH) * lastMonth), 0, lastMonth);
  };

  const changeMobileMonth = (nextMonth: number) => {
    const next = clamp(nextMonth, 0, lastMonth);
    if (next === mobileMonth) return;
    setMobileDirection(next > mobileMonth ? 1 : -1);
    setMobileMonth(next);
  };

  const beginMobileGesture = (event: PointerEvent<SVGSVGElement>) => {
    gestureStart.current = { x: event.clientX, y: event.clientY };
  };

  const moveMobileGesture = (event: PointerEvent<SVGSVGElement>) => {
    const start = gestureStart.current;
    if (!start || lastMonth === 0) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < 6 || Math.abs(deltaX) <= Math.abs(deltaY)) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const pixelsPerMonth = (bounds.width / MOBILE_WIDTH) * (MOBILE_PLOT_WIDTH / monthDivisor);
    setDragMonth(clamp(mobileMonth - deltaX / pixelsPerMonth, 0, lastMonth));
  };

  const finishMobileGesture = (event: PointerEvent<SVGSVGElement>) => {
    const start = gestureStart.current;
    gestureStart.current = null;
    setDragMonth(null);
    if (!start) return;

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    const isHorizontalSwipe = Math.abs(deltaX) >= 34 && Math.abs(deltaX) > Math.abs(deltaY) * 1.15;

    if (isHorizontalSwipe) {
      const bounds = event.currentTarget.getBoundingClientRect();
      const pixelsPerMonth = (bounds.width / MOBILE_WIDTH) * (MOBILE_PLOT_WIDTH / monthDivisor);
      const steps = clamp(Math.max(1, Math.round(Math.abs(deltaX) / pixelsPerMonth)), 1, 3);
      changeMobileMonth(mobileMonth + (deltaX < 0 ? steps : -steps));
      return;
    }

    if (Math.abs(deltaX) < 12 && Math.abs(deltaY) < 12) {
      changeMobileMonth(monthAtMobilePointer(event));
    }
  };

  const handleKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    selectMonth(clamp((hover?.month ?? 0) + direction, 0, lastMonth));
  };

  const hoveredPoint = hover
    ? point(hover.month, series[hover.seriesIndex]?.values[hover.month] ?? 0)
    : null;
  const activeSeries = focusedSeries ?? hover?.seriesIndex ?? selectedSeries;
  const latestSeries = series.at(-1);
  const previousSeries = series.at(-2);
  const latestMonthValue = latestSeries?.values[mobileMonth] ?? null;
  const previousMonthValue = previousSeries?.values[mobileMonth] ?? null;
  const mobileYearChange = calculatePercentageChange(latestMonthValue, previousMonthValue);
  const mobileIndicatorMonth = dragMonth ?? mobileMonth;
  const mobileIndicatorX = mobilePoint(mobileIndicatorMonth, 0).x;
  const mobileBandWidth = MOBILE_PLOT_WIDTH / (lastMonth + 1);
  const mobileBandX = clamp(
    mobileIndicatorX - mobileBandWidth / 2,
    MOBILE_LEFT,
    MOBILE_WIDTH - MOBILE_RIGHT - mobileBandWidth,
  );

  return (
    <div>
      <div className="mb-4 grid grid-cols-3 gap-2 text-base text-neutral-500 sm:flex sm:flex-wrap sm:items-center dark:text-neutral-400">
        {series.map((year, index) => {
          const isMuted = activeSeries !== null && activeSeries !== index;
          return (
            <button
              key={year.year}
              type="button"
              aria-pressed={selectedSeries === index}
              className={`flex min-h-11 items-center justify-center gap-2 rounded-md px-2 py-1 transition-[color,background-color,opacity,transform] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:min-h-0 ${
                isMuted ? "opacity-40" : "bg-neutral-100 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100"
              }`}
              onClick={() => setSelectedSeries((current) => current === index ? null : index)}
              onPointerEnter={() => setFocusedSeries(index)}
              onPointerLeave={() => setFocusedSeries(hover?.seriesIndex ?? null)}
              onFocus={() => setFocusedSeries(index)}
              onBlur={() => setFocusedSeries(hover?.seriesIndex ?? null)}
            >
              <span className="h-0.5 w-5" style={{ backgroundColor: seriesColor(index, series.length) }} />
              {year.year}
            </button>
          );
        })}
        <span className="ml-auto hidden text-sm text-neutral-400 dark:text-neutral-500 sm:inline">Passe o cursor para comparar</span>
      </div>

      <div className="lg:hidden">
        <svg
          viewBox={`0 0 ${MOBILE_WIDTH} ${MOBILE_HEIGHT}`}
          className="h-auto w-full touch-pan-y select-none"
          role="img"
          aria-label="Vendas líquidas mensais comparadas por ano. Toque em um mês ou deslize para os lados."
          onPointerDown={beginMobileGesture}
          onPointerMove={moveMobileGesture}
          onPointerUp={finishMobileGesture}
          onPointerCancel={() => {
            gestureStart.current = null;
            setDragMonth(null);
          }}
        >
          {yTicks.map((tick) => {
            const y = MOBILE_TOP + (1 - tick / maxValue) * MOBILE_PLOT_HEIGHT;
            return (
              <line
                key={tick}
                x1={MOBILE_LEFT}
                y1={y}
                x2={MOBILE_WIDTH - MOBILE_RIGHT}
                y2={y}
                className="stroke-neutral-200 dark:stroke-neutral-800"
                strokeWidth="1"
              />
            );
          })}

          <rect
            x={mobileBandX}
            y={MOBILE_TOP}
            width={mobileBandWidth}
            height={MOBILE_PLOT_HEIGHT}
            rx="7"
            className={`fill-blue-500/5 dark:fill-blue-400/5 ${dragMonth === null ? "transition-all duration-300 ease-out" : ""}`}
          />

          <line
            x1={mobileIndicatorX}
            y1={MOBILE_TOP}
            x2={mobileIndicatorX}
            y2={MOBILE_TOP + MOBILE_PLOT_HEIGHT}
            className={`stroke-blue-500/40 dark:stroke-blue-400/40 ${dragMonth === null ? "transition-all duration-300 ease-out" : ""}`}
            strokeWidth="1"
            strokeDasharray="4 5"
          />

          {series.map((year, seriesIndex) => {
            const points = year.values
              .map((value, month) => (value === null ? null : { ...mobilePoint(month, value), value, month }))
              .filter((value): value is { x: number; y: number; value: number; month: number } => value !== null);
            const path = points.map((value, index) => `${index === 0 ? "M" : "L"} ${value.x} ${value.y}`).join(" ");
            const isMuted = activeSeries !== null && activeSeries !== seriesIndex;
            const isActive = activeSeries === seriesIndex;

            return (
              <g key={year.year} className="transition-opacity duration-200" opacity={isMuted ? 0.2 : 1}>
                <path
                  d={path}
                  fill="none"
                  stroke={seriesColor(seriesIndex, series.length)}
                  strokeWidth={isActive ? 4 : seriesIndex === series.length - 1 ? 3 : 2}
                  vectorEffect="non-scaling-stroke"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {points.map((value) => {
                  const selected = mobileMonth === value.month;
                  return (
                    <circle
                      key={value.month}
                      cx={value.x}
                      cy={value.y}
                      r={selected ? 5 : seriesIndex === series.length - 1 ? 3 : 2}
                      fill={seriesColor(seriesIndex, series.length)}
                      stroke={selected ? "white" : "transparent"}
                      strokeWidth={selected ? 2 : 0}
                      vectorEffect="non-scaling-stroke"
                      className="transition-all duration-300"
                    />
                  );
                })}
              </g>
            );
          })}

          {EXECUTIVE_MONTHS_SHORT.slice(0, lastMonth + 1).map((month, index) => {
            const x = mobilePoint(index, 0).x;
            const selected = mobileMonth === index;
            return (
              <text
                key={month}
                x={x}
                y={MOBILE_HEIGHT - 9}
                textAnchor="middle"
                className={`text-[12px] ${selected ? "fill-blue-600 font-semibold dark:fill-blue-400" : "fill-neutral-400 dark:fill-neutral-500"}`}
              >
                {month}
              </text>
            );
          })}
        </svg>

        <div className="mt-2 border-t border-neutral-200 pt-4 dark:border-neutral-800">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => changeMobileMonth(mobileMonth - 1)}
              disabled={mobileMonth === 0}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-neutral-200 text-neutral-600 transition-[color,background-color,transform] hover:bg-neutral-100 active:scale-95 disabled:opacity-30 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              aria-label="Mês anterior"
            >
              <ChevronLeft className="h-5 w-5" strokeWidth={2} />
            </button>
            <div key={`month-heading-${mobileMonth}`} className={`text-center ${mobileDirection > 0 ? "animate-executive-month-forward" : "animate-executive-month-backward"}`}>
              <p className="text-xl font-semibold text-neutral-950 dark:text-white">{EXECUTIVE_MONTHS_LONG[mobileMonth]}</p>
              {mobileYearChange !== null && previousSeries && (
                <p className={`mt-0.5 text-sm font-semibold ${changeClass(mobileYearChange)}`}>
                  {formatSignedPercentage(mobileYearChange)} contra {previousSeries.year}
                </p>
              )}
              {latestMonthValue === null && latestSeries && (
                <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">{latestSeries.year} ainda sem fechamento</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => changeMobileMonth(mobileMonth + 1)}
              disabled={mobileMonth === lastMonth}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-neutral-200 text-neutral-600 transition-[color,background-color,transform] hover:bg-neutral-100 active:scale-95 disabled:opacity-30 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              aria-label="Próximo mês"
            >
              <ChevronRight className="h-5 w-5" strokeWidth={2} />
            </button>
          </div>
          <div key={`month-values-${mobileMonth}`} className={`mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 ${mobileDirection > 0 ? "animate-executive-month-forward" : "animate-executive-month-backward"}`}>
            {series.map((year, index) => (
              <div key={year.year} className={activeSeries !== null && activeSeries !== index ? "opacity-40" : ""}>
                <p className="flex items-center gap-1.5 text-sm text-neutral-500 dark:text-neutral-400">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: seriesColor(index, series.length) }} />
                  {year.year}
                </p>
                <p className="mt-1 text-base font-semibold tabular-nums text-neutral-950 dark:text-white">
                  {year.values[mobileMonth] === null
                    ? "—"
                    : formatExecutiveCurrency(year.values[mobileMonth] ?? 0, exactValues)}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm text-neutral-400 dark:text-neutral-500">Toque em um mês ou deslize para os lados.</p>
        </div>
      </div>

      <div className="hidden overflow-x-auto lg:block">
        <div ref={desktopChartRef} className="relative h-[340px] min-w-[760px] w-full">
          <svg
            viewBox={`0 0 ${desktopWidth} ${HEIGHT}`}
            className="h-full w-full touch-pan-x select-none outline-none"
            role="img"
            aria-label="Vendas líquidas mensais comparadas por ano. Use as setas para navegar entre os meses."
            tabIndex={0}
            onFocus={() => {
              if (!hover) selectMonth(0);
            }}
            onBlur={() => {
              setHover(null);
              setFocusedSeries(null);
            }}
            onKeyDown={handleKeyDown}
            onPointerMove={selectAtPointer}
            onPointerDown={selectAtPointer}
            onPointerLeave={() => {
              setHover(null);
              setFocusedSeries(null);
            }}
          >
            {hover && (
              <rect
                x={clamp(
                  point(hover.month, 0).x - desktopPlotWidth / (lastMonth + 1) / 2,
                  LEFT,
                  desktopWidth - RIGHT - desktopPlotWidth / (lastMonth + 1),
                )}
                y={TOP}
                width={desktopPlotWidth / (lastMonth + 1)}
                height={PLOT_HEIGHT}
                rx="6"
                className="fill-blue-500/5 dark:fill-blue-400/5"
              />
            )}

            {yTicks.map((tick) => {
              const y = TOP + (1 - tick / maxValue) * PLOT_HEIGHT;
              return (
                <g key={tick}>
                  <line x1={LEFT} y1={y} x2={desktopWidth - RIGHT} y2={y} className="stroke-neutral-200 dark:stroke-neutral-800" strokeWidth="1" />
                  <text x={LEFT - 10} y={y + 4} textAnchor="end" className="fill-neutral-400 text-[12px] dark:fill-neutral-500">
                    {formatCurrencyCompact(tick)}
                  </text>
                </g>
              );
            })}

            {EXECUTIVE_MONTHS_SHORT.slice(0, lastMonth + 1).map((month, index) => {
              const x = point(index, 0).x;
              const selected = hover?.month === index;
              return (
                <text
                  key={month}
                  x={x}
                  y={HEIGHT - 9}
                  textAnchor="middle"
                  className={`text-[12px] transition-colors ${selected ? "fill-blue-600 font-semibold dark:fill-blue-400" : "fill-neutral-400 dark:fill-neutral-500"}`}
                >
                  {month}
                </text>
              );
            })}

            {series.map((year, seriesIndex) => {
              const points = year.values
                .map((value, month) => (value === null ? null : { ...point(month, value), value, month }))
                .filter((value): value is { x: number; y: number; value: number; month: number } => value !== null);
              const path = points.map((value, index) => `${index === 0 ? "M" : "L"} ${value.x} ${value.y}`).join(" ");
              const isMuted = activeSeries !== null && activeSeries !== seriesIndex;
              const isActive = activeSeries === seriesIndex;

              return (
                <g key={year.year} className="transition-opacity duration-200" opacity={isMuted ? 0.22 : 1}>
                  <path
                    d={path}
                    fill="none"
                    stroke={seriesColor(seriesIndex, series.length)}
                    strokeWidth={isActive ? 4 : seriesIndex === series.length - 1 ? 3 : 2}
                    vectorEffect="non-scaling-stroke"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="transition-[stroke-width,opacity] duration-200"
                  />
                  {points.map((value) => {
                    const selected = hover?.month === value.month;
                    return (
                      <circle
                        key={value.month}
                        cx={value.x}
                        cy={value.y}
                        r={selected ? (isActive ? 6 : 4) : seriesIndex === series.length - 1 ? 3.5 : 2.5}
                        fill={seriesColor(seriesIndex, series.length)}
                        stroke={selected ? "white" : "transparent"}
                        strokeWidth={selected ? 2 : 0}
                        vectorEffect="non-scaling-stroke"
                        className="transition-all duration-200"
                      />
                    );
                  })}
                </g>
              );
            })}

            {hoveredPoint && (
              <line
                x1={hoveredPoint.x}
                y1={TOP}
                x2={hoveredPoint.x}
                y2={TOP + PLOT_HEIGHT}
                className="stroke-blue-500/50 dark:stroke-blue-400/50"
                strokeWidth="1"
                strokeDasharray="4 5"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>

          {hover && hoveredPoint && (
            <ChartTooltip
              month={hover.month}
              seriesIndex={hover.seriesIndex}
              series={series}
              x={hoveredPoint.x}
              y={hoveredPoint.y}
              chartWidth={desktopWidth}
              lastMonth={lastMonth}
              exactValues={exactValues}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ChartTooltip({
  month,
  seriesIndex,
  series,
  x,
  y,
  chartWidth,
  lastMonth,
  exactValues,
}: {
  month: number;
  seriesIndex: number;
  series: ExecutiveReportData["yearlySeries"];
  x: number;
  y: number;
  chartWidth: number;
  lastMonth: number;
  exactValues: boolean;
}) {
  const horizontalPosition = lastMonth === 0 ? 0.5 : month / lastMonth;
  const horizontalTransform = horizontalPosition <= 0.25
    ? "translateX(8px)"
    : horizontalPosition >= 0.75
      ? "translateX(calc(-100% - 8px))"
      : "translateX(-50%)";
  const showBelow = y < 130;
  const top = showBelow ? y + 14 : y - 14;
  const verticalTransform = showBelow ? "translateY(0)" : "translateY(-100%)";

  return (
    <div
      className={`${exactValues ? "w-72" : "w-56"} pointer-events-none absolute z-10 rounded-lg border border-neutral-200 bg-white/95 p-4 shadow-xl shadow-black/10 backdrop-blur-sm dark:border-neutral-700 dark:bg-neutral-950/95 dark:shadow-black/40`}
      style={{
        left: `${(x / chartWidth) * 100}%`,
        top: `${(top / HEIGHT) * 100}%`,
        transform: `${horizontalTransform} ${verticalTransform}`,
      }}
      aria-hidden="true"
    >
      <p className="text-base font-semibold text-neutral-950 dark:text-white">{EXECUTIVE_MONTHS_LONG[month]}</p>
      <div className="mt-3 space-y-2">
        {series.map((year, index) => (
          <div
            key={year.year}
            className={`flex items-center justify-between gap-3 text-sm ${index === seriesIndex ? "font-semibold text-neutral-950 dark:text-white" : "text-neutral-500 dark:text-neutral-400"}`}
          >
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: seriesColor(index, series.length) }} />
              {year.year}
            </span>
            <span className="tabular-nums">
              {year.values[month] === null
                ? "—"
                : formatExecutiveCurrency(year.values[month] ?? 0, exactValues)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function findLatestSeriesWithValue(series: ExecutiveReportData["yearlySeries"], month: number): number {
  for (let index = series.length - 1; index >= 0; index -= 1) {
    if (series[index]?.values[month] !== null) return index;
  }
  return 0;
}

function seriesColor(index: number, total: number): string {
  if (index === total - 1) return "#2f80ed";
  if (index === total - 2) return "#f97316";
  return HISTORICAL_COLORS[index % HISTORICAL_COLORS.length];
}

function findLastMonthWithValue(series: ExecutiveReportData["yearlySeries"]): number {
  const latestSeries = series.at(-1);
  if (latestSeries) {
    for (let month = 11; month >= 0; month -= 1) {
      if (latestSeries.values[month] !== null) return month;
    }
  }
  for (let month = 11; month >= 0; month -= 1) {
    if (series.some((year) => year.values[month] !== null)) return month;
  }
  return 0;
}

function changeClass(value: number): string {
  if (Math.abs(value) < 0.05) return "text-neutral-500 dark:text-neutral-400";
  return value > 0
    ? "text-emerald-700 dark:text-emerald-400"
    : "text-red-700 dark:text-red-400";
}

function niceMaximum(value: number): number {
  const power = 10 ** Math.floor(Math.log10(value));
  const normalized = value / power;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * power;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
