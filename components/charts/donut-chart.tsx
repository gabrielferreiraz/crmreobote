"use client";

import { useEffect, useState } from "react";

type Slice = { label: string; value: number; color: string };

// r escolhido de propósito: 2πr ≈ 100, então cada fatia em % do total já é
// diretamente o tamanho do traço no strokeDasharray, sem conversão extra.
const RADIUS = 15.9155;
// Espaço em branco entre fatias (mesma unidade de strokeDasharray/pct, já
// que 2πr ≈ 100) — sem isso, fatias vizinhas só se distinguem pela mudança
// de cor, e cores próximas (ex.: dois tons de verde) ficam coladas numa
// única mancha.
const GAP_PCT = 1.1;

/** Rosca via strokeDasharray — sem lib de gráfico, só SVG. Passa o mouse numa
 * fatia (ou na legenda) e ela ganha destaque, com o centro trocando pro
 * detalhe daquela fatia especificamente. */
export function DonutChart({
  slices,
  centerValue,
  centerLabel,
}: {
  slices: Slice[];
  centerValue?: string;
  centerLabel?: string;
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0) || 1;
  const [hovered, setHovered] = useState<number | null>(null);
  const [grown, setGrown] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  let cumulative = 0;
  const geometry = slices.map((s) => {
    const pct = (s.value / total) * 100;
    const offset = -cumulative;
    cumulative += pct;
    return { pct, offset };
  });

  const hoveredSlice = hovered !== null ? slices[hovered] : null;
  const hoveredPct = hoveredSlice ? Math.round((hoveredSlice.value / total) * 100) : null;

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
      <div className="relative h-40 w-40 shrink-0">
        <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
          <circle cx="18" cy="18" r={RADIUS} fill="none" strokeWidth="3.5" className="stroke-neutral-100 dark:stroke-neutral-800" />
          {slices.map((s, i) => {
            if (s.value <= 0) return null;
            const { pct, offset } = geometry[i];
            const isHovered = hovered === i;
            const dimmed = hovered !== null && !isHovered;
            // Fatia normal perde GAP_PCT pro espaço em branco; fatia pequena
            // (menor que o próprio gap) não pode virar 0 e sumir — mantém uma
            // lasca mínima visível em vez de Math.max(0, ...) apagar ela.
            const gapped = pct <= GAP_PCT ? Math.max(pct * 0.6, Math.min(pct, 0.8)) : pct - GAP_PCT;
            return (
              <circle
                key={i}
                cx="18"
                cy="18"
                r={RADIUS}
                fill="none"
                stroke={s.color}
                strokeWidth={isHovered ? "4.5" : "3.5"}
                strokeDasharray={`${grown ? gapped : 0} ${100 - (grown ? gapped : 0)}`}
                strokeDashoffset={offset}
                opacity={dimmed ? 0.35 : 1}
                className="cursor-pointer transition-[stroke-width,opacity,stroke-dasharray] duration-500 ease-out"
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
              />
            );
          })}
        </svg>
        {(centerValue || centerLabel || hoveredSlice) && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            {hoveredSlice ? (
              <>
                <span className="max-w-[104px] text-lg leading-tight font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                  {hoveredPct}%
                </span>
                <span className="mt-0.5 line-clamp-2 max-w-[104px] text-[11px] leading-tight text-neutral-500 dark:text-neutral-400">
                  {hoveredSlice.label}
                </span>
              </>
            ) : (
              <>
                {centerValue && (
                  // Largura e tamanho da fonte limitados ao "furo" real da rosca (~126px de
                  // diâmetro) — um valor curto ("97%") cabe numa linha em text-lg, mas um
                  // valor longo (moeda, ex. "R$ 1.670.000,00") em text-lg atravessa o anel;
                  // por isso a fonte encolhe e a largura força quebra de linha conforme o
                  // texto cresce, em vez de vazar por cima do gráfico.
                  <span
                    className={`max-w-[104px] leading-tight font-semibold tabular-nums text-neutral-900 dark:text-neutral-100 ${
                      centerValue.length > 10 ? "text-sm" : centerValue.length > 6 ? "text-base" : "text-lg"
                    }`}
                  >
                    {centerValue}
                  </span>
                )}
                {centerLabel && <span className="mt-0.5 text-[11px] text-neutral-400 dark:text-neutral-500">{centerLabel}</span>}
              </>
            )}
          </div>
        )}
      </div>
      <div className="w-full min-w-0 flex-1 space-y-1 sm:w-auto">
        {slices.map((s, i) => {
          const isHovered = hovered === i;
          const dimmed = hovered !== null && !isHovered;
          return (
            <button
              key={i}
              type="button"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
              className={`-mx-2 flex w-[calc(100%+16px)] items-center gap-2.5 rounded-md px-2 py-1 text-left text-sm transition-colors ${
                isHovered ? "bg-neutral-50 dark:bg-neutral-800/60" : ""
              }`}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full transition-opacity"
                style={{ backgroundColor: s.color, opacity: dimmed ? 0.4 : 1 }}
              />
              <span
                className={`min-w-0 flex-1 truncate transition-colors ${
                  dimmed
                    ? "text-neutral-400 dark:text-neutral-600"
                    : isHovered
                      ? "text-neutral-900 dark:text-neutral-100"
                      : "text-neutral-600 dark:text-neutral-400"
                }`}
              >
                {s.label}
              </span>
              <span
                className={`shrink-0 font-medium tabular-nums transition-colors ${
                  dimmed ? "text-neutral-400 dark:text-neutral-600" : "text-neutral-800 dark:text-neutral-200"
                }`}
              >
                {Math.round((s.value / total) * 100)}%
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
