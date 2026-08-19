"use client";

import { useEffect, useState } from "react";

const DEFAULT_COLOR = "#2a78d6";

export function BarRow({
  label,
  value,
  max,
  displayValue,
  color,
  wrapLabel = false,
}: {
  label: string;
  value: number;
  max: number;
  displayValue: string;
  /** Cor da barra (ex.: a cor já configurada da etapa) — cai no azul padrão se omitida. */
  color?: string | null;
  /** true = rótulo longo quebra em até 2 linhas em vez de cortar com "..."
   * (ver motivos de perda em page.tsx, que agora inclui "(CRM anterior)" —
   * ficava ilegível truncado, ex.: "Não Respondeu (CR..."). false (padrão)
   * mantém o corte de sempre — os outros usos deste componente (ver
   * admin-reports-view.tsx) têm rótulos curtos e contam com a largura fixa
   * pra manter as barras alinhadas entre si. */
  wrapLabel?: boolean;
}) {
  const targetPct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  const [pct, setPct] = useState(0);

  // Cresce do zero ao montar — sem isso a barra "aparece" pronta, perde o
  // efeito de comparação que o crescimento comunica. requestAnimationFrame
  // (não só setState direto) garante que o navegador pintou o 0% primeiro,
  // senão a transição de largura não tem de onde partir.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setPct(targetPct));
    return () => cancelAnimationFrame(frame);
  }, [targetPct]);

  const barColor = color || DEFAULT_COLOR;

  return (
    <div className="group/row -mx-2 flex items-center gap-3 rounded-md px-2 py-1 text-sm transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
      <span
        title={wrapLabel ? undefined : label}
        className={`shrink-0 text-neutral-500 dark:text-neutral-400 ${
          wrapLabel ? "w-48 leading-tight whitespace-normal" : "w-40 truncate"
        }`}
      >
        {label}
      </span>
      <div className="relative h-2.5 flex-1 rounded-full bg-neutral-100 dark:bg-neutral-800">
        <div
          className="h-full rounded-full transition-[width,filter] duration-700 ease-out group-hover/row:brightness-110"
          style={{ width: `${pct}%`, backgroundColor: barColor }}
        />
      </div>
      <span className="w-24 shrink-0 text-right font-medium tabular-nums text-neutral-800 dark:text-neutral-200">
        {displayValue}
      </span>
    </div>
  );
}
