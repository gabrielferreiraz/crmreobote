"use client";

import { useEffect, useRef, useState } from "react";
import { formatCurrency, formatCurrencyCompact } from "@/lib/format";

// Mesma curva de desaceleração do resto do sistema (--ease-smooth,
// cubic-bezier(0.16, 1, 0.3, 1) — ver globals.css), só que como função pra
// aplicar quadro a quadro em JS em vez de CSS. É a aproximação matemática
// padrão dessa curva ("easeOutExpo"): sem isso os números subiam com uma
// physics ligeiramente diferente (cúbica) do resto da UI — ninguém aponta o
// dedo, mas destoava por baixo.
function easeOutExpo(t: number) {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

const DURATION_MS = 900;

/** Sobe de 0 até o valor final uma vez, ao montar — dá um "tchan" nos números do resumo sem precisar de lib de animação. */
export function CountUpValue({
  value,
  format = "number",
}: {
  value: number;
  /** "currency-compact" = formatCurrencyCompact ("R$ 639,9 mi") — pros cards de KPI/hero do redesign (ver lib/format.ts), onde o valor cheio ocuparia largura demais. */
  format?: "number" | "currency" | "currency-compact";
}) {
  const [display, setDisplay] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    let frame: number;
    function tick(timestamp: number) {
      if (startRef.current === null) startRef.current = timestamp;
      const elapsed = timestamp - startRef.current;
      const progress = Math.min(elapsed / DURATION_MS, 1);
      setDisplay(Math.round(value * easeOutExpo(progress)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // tabular-nums: sem isso, cada dígito tem sua própria largura (1 é mais
  // estreito que 8) — enquanto o número sobe rapidinho quadro a quadro, o
  // texto inteiro "treme" horizontalmente a cada troca de dígito. Com
  // largura fixa por dígito o número só sobe, sem nenhum tremor lateral.
  return (
    <span className="tabular-nums">
      {format === "currency"
        ? formatCurrency(display)
        : format === "currency-compact"
          ? formatCurrencyCompact(display)
          : display.toLocaleString("pt-BR")}
    </span>
  );
}
