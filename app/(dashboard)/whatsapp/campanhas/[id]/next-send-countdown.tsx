"use client";

import { useEffect, useState } from "react";
import { Clock3 } from "lucide-react";

// Acima disso (a estimativa caiu fora da janela de hoje, ex.: só volta amanhã
// de manhã) uma contagem MM:SS não faz sentido — mostra a data/hora certa em
// vez de "638:42".
const MAX_COUNTDOWN_MS = 60 * 60 * 1000;

function formatCountdown(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Contagem regressiva até `targetAt` (nextSendEstimateAt, calculado em
 * lib/campaigns/list.ts, já empurrado pra dentro da janela de horário/dias
 * permitida) — é uma estimativa, não uma garantia: o motor de verdade
 * (shouldSendNow em lib/campaigns/engine.ts) sorteia um novo limiar dentro da
 * faixa min/max a cada checagem do cron, então o envio real pode acontecer um
 * pouco antes ou depois de zerar.
 */
export function NextSendCountdown({ targetAt }: { targetAt: string }) {
  const target = new Date(targetAt).getTime();
  const [remaining, setRemaining] = useState(() => target - Date.now());

  useEffect(() => {
    const interval = setInterval(() => setRemaining(target - Date.now()), 1000);
    return () => clearInterval(interval);
  }, [target]);

  const display =
    remaining <= 0
      ? "a qualquer momento"
      : remaining <= MAX_COUNTDOWN_MS
        ? formatCountdown(remaining)
        : new Date(target).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

  return (
    <span className="inline-flex items-center gap-1.5 font-medium text-neutral-700 dark:text-neutral-300">
      <Clock3 className="h-3.5 w-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
      Próximo envio estimado:
      <span className="tabular-nums">{display}</span>
    </span>
  );
}
