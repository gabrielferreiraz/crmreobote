"use client";

import { useState } from "react";
import type { RmktWaveInput } from "@/lib/campaigns/validate-rmkt";

/**
 * Estado/lógica de "RMKT" (ondas de reengajamento) extraído de
 * components/send-leads-dialog.tsx — de propósito só isso (não o slider de
 * delay nem a lista de scripts, que também são duplicados hoje entre os
 * diálogos de envio em massa, mas com padrões intencionalmente diferentes
 * entre eles). Passa a ser usado em 3 lugares: SendLeadsDialog (o
 * original), BulkSendMessageDialog (ganhou paridade de RMKT, ver
 * app/api/deals/bulk-send-message/route.ts) e o novo
 * BulkSendConversationsDialog — sem isso, a MESMA lógica ficaria copiada 3
 * vezes, com risco real de uma cópia divergir da outra depois.
 */

export type WaveRow = { dayOffset: string; scriptId: string };

export function useRmktWaves() {
  const [rmktEnabled, setRmktEnabled] = useState(false);
  const [waves, setWaves] = useState<WaveRow[]>([{ dayOffset: "3", scriptId: "" }]);
  const [noReplyDays, setNoReplyDays] = useState("3");

  function addWave() {
    setWaves((prev) => [...prev, { dayOffset: "", scriptId: "" }]);
  }
  function removeWave(index: number) {
    setWaves((prev) => prev.filter((_, i) => i !== index));
  }
  function updateWave(index: number, patch: Partial<WaveRow>) {
    setWaves((prev) => prev.map((w, i) => (i === index ? { ...w, ...patch } : w)));
  }

  const noReplyDaysValid = !!noReplyDays.trim() && Number(noReplyDays) > 0;
  const wavesValid =
    !rmktEnabled ||
    (waves.length > 0 &&
      waves.every((w) => w.dayOffset.trim() && w.scriptId) &&
      waves.every((w, i) => i === 0 || Number(w.dayOffset) > Number(waves[i - 1].dayOffset)) &&
      waves.every((w) => Number(w.dayOffset) < Number(noReplyDays || 0)));
  // As duas condições sempre andaram juntas em canSend (ver
  // send-leads-dialog.tsx original) — expostas já combinadas aqui, cada
  // chamador não precisa lembrar de checar as duas separado.
  const valid = noReplyDaysValid && wavesValid;

  /** Pronto pra espalhar (`...`) no body da requisição — mesmo shape que
   * app/api/contacts/bulk-send-leads/route.ts e
   * app/api/deals/bulk-send-message/route.ts esperam. */
  function serialize(): { rmktEnabled: boolean; rmktWaves?: RmktWaveInput[]; noReplyDays: number } {
    return {
      rmktEnabled,
      rmktWaves: rmktEnabled
        ? waves.map((w) => ({ dayOffset: Number(w.dayOffset), scriptId: w.scriptId }))
        : undefined,
      noReplyDays: Number(noReplyDays),
    };
  }

  return {
    rmktEnabled,
    setRmktEnabled,
    waves,
    addWave,
    removeWave,
    updateWave,
    noReplyDays,
    setNoReplyDays,
    valid,
    serialize,
  };
}

export type UseRmktWavesReturn = ReturnType<typeof useRmktWaves>;
