"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Slider de faixa com duas bolinhas arrastáveis (min/max) — não existia
 * nenhum componente assim no projeto nem lib de slider instalada, então é
 * feito na mão com Pointer Events (arrasto com mouse/toque/caneta, tudo no
 * mesmo código, sem listener separado por tipo de ponteiro).
 */
export function DualRangeSlider({
  min,
  max,
  step = 1,
  value,
  onChange,
}: {
  min: number;
  max: number;
  step?: number;
  /** [valorMínimo, valorMáximo] */
  value: [number, number];
  onChange: (value: [number, number]) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<"min" | "max" | null>(null);

  // Lidos dentro do listener via .current (não fechados no efeito) — o pai
  // passa um onChange novo a cada render (ver bulk-send-message-dialog.tsx),
  // então fechar sobre eles obrigaria a reatar o listener a cada pixel de
  // arrasto; assim o efeito de arrasto só reatua quando ele começa/termina.
  // A sincronização roda depois da renderização (não durante), como as
  // regras de hooks exigem.
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  });

  const clamp = useCallback((v: number) => Math.min(max, Math.max(min, v)), [min, max]);
  const percentFor = useCallback((v: number) => ((clamp(v) - min) / (max - min)) * 100, [clamp, min, max]);

  const valueFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return min;
      const rect = track.getBoundingClientRect();
      const ratio = rect.width === 0 ? 0 : Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const raw = min + ratio * (max - min);
      return clamp(Math.round(raw / step) * step);
    },
    [min, max, step, clamp],
  );

  // Arrasto via listener no document (não só no handle) — sem isso, mover o
  // ponteiro rápido demais escapa do elemento pequeno da bolinha e o
  // arrasto trava no meio do caminho.
  useEffect(() => {
    if (!dragging) return;

    function handlePointerMove(e: PointerEvent) {
      const v = valueFromClientX(e.clientX);
      const current = valueRef.current;
      if (dragging === "min") {
        onChangeRef.current([Math.min(v, current[1]), current[1]]);
      } else {
        onChangeRef.current([current[0], Math.max(v, current[0])]);
      }
    }
    function handlePointerUp() {
      setDragging(null);
    }

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerUp);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [dragging, valueFromClientX]);

  function handleKeyDown(e: React.KeyboardEvent, which: "min" | "max") {
    const delta = e.key === "ArrowLeft" || e.key === "ArrowDown" ? -step : e.key === "ArrowRight" || e.key === "ArrowUp" ? step : 0;
    if (delta === 0) return;
    e.preventDefault();
    if (which === "min") {
      onChange([clamp(Math.min(value[0] + delta, value[1])), value[1]]);
    } else {
      onChange([value[0], clamp(Math.max(value[1] + delta, value[0]))]);
    }
  }

  function handleTrackPointerDown(e: React.PointerEvent) {
    // Clique direto na trilha (fora das bolinhas) pula o mais próximo dos
    // dois pra essa posição, já iniciando o arrasto dele — atalho comum em
    // sliders de faixa, evita ter que primeiro acertar a bolinha exata.
    const v = valueFromClientX(e.clientX);
    const which = Math.abs(v - value[0]) <= Math.abs(v - value[1]) ? "min" : "max";
    if (which === "min") onChange([Math.min(v, value[1]), value[1]]);
    else onChange([value[0], Math.max(v, value[0])]);
    setDragging(which);
  }

  return (
    <div className="px-2.5 py-3">
      <div
        ref={trackRef}
        onPointerDown={handleTrackPointerDown}
        className="relative h-1.5 cursor-pointer rounded-full bg-neutral-200 dark:bg-neutral-700"
      >
        <div
          className="absolute h-full rounded-full bg-neutral-900 dark:bg-white"
          style={{ left: `${percentFor(value[0])}%`, right: `${100 - percentFor(value[1])}%` }}
        />
        {(["min", "max"] as const).map((which) => (
          <div
            key={which}
            role="slider"
            tabIndex={0}
            aria-label={which === "min" ? "Delay mínimo" : "Delay máximo"}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={which === "min" ? value[0] : value[1]}
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              setDragging(which);
            }}
            onKeyDown={(e) => handleKeyDown(e, which)}
            className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-neutral-900 bg-white shadow-sm outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-neutral-400 active:cursor-grabbing dark:border-white dark:bg-neutral-900"
            style={{ left: `${percentFor(which === "min" ? value[0] : value[1])}%` }}
          />
        ))}
      </div>
    </div>
  );
}
