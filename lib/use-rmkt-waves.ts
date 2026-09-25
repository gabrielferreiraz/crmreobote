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

export function useRmktWaves({
  automaticNoReplyDays = false,
  initialEnabled = false,
  initialWaves,
  initialNoReplyDays = "3",
  initialMarkLostOnNoReply = false,
}: {
  automaticNoReplyDays?: boolean;
  initialEnabled?: boolean;
  initialWaves?: WaveRow[];
  initialNoReplyDays?: string;
  initialMarkLostOnNoReply?: boolean;
} = {}) {
  const [rmktEnabled, setRmktEnabled] = useState(initialEnabled);
  const [waves, setWaves] = useState<WaveRow[]>(initialWaves?.length ? initialWaves : [{ dayOffset: "3", scriptId: "" }]);
  const [noReplyDays, setNoReplyDays] = useState(initialNoReplyDays);
  // Só usado no contexto de negócio já existente (Pipeline → disparo em
  // massa) — ver dealsContext em rmkt-waves-fields.tsx. Default false:
  // pedido explícito era ter a OPÇÃO de ligar/desligar, não ligar sozinho.
  const [markLostOnNoReply, setMarkLostOnNoReply] = useState(initialMarkLostOnNoReply);

  function addWave() {
    setWaves((prev) => [...prev, { dayOffset: "", scriptId: "" }]);
  }
  function removeWave(index: number) {
    setWaves((prev) => prev.filter((_, i) => i !== index));
  }
  function updateWave(index: number, patch: Partial<WaveRow>) {
    setWaves((prev) => prev.map((w, i) => (i === index ? { ...w, ...patch } : w)));
  }

  // No envio de leads, a última onda já define o fim da sequência. Mantemos
  // um dia técnico depois dela para a engine registrar "Não respondeu", sem
  // expor um prazo redundante para quem está configurando o disparo.
  const resolvedNoReplyDays = automaticNoReplyDays
    ? Math.max(2, ...waves.map((wave) => Number(wave.dayOffset) || 0)) + 1
    : Number(noReplyDays);
  const noReplyDaysValid = automaticNoReplyDays
    ? Number.isInteger(resolvedNoReplyDays) && resolvedNoReplyDays <= 90
    : !!noReplyDays.trim() && resolvedNoReplyDays > 0;
  const wavesValid =
    !rmktEnabled ||
    (waves.length > 0 &&
      waves.every((w) => w.dayOffset.trim() && w.scriptId) &&
      waves.every((w, i) => i === 0 || Number(w.dayOffset) > Number(waves[i - 1].dayOffset)) &&
      waves.every((w) => Number(w.dayOffset) < resolvedNoReplyDays));
  // As condições sempre andaram juntas em canSend (ver send-leads-dialog.tsx
  // original) — expostas já combinadas aqui, cada chamador não precisa
  // lembrar de checar cada uma separado.
  const valid = noReplyDaysValid && wavesValid;

  /** Pronto pra espalhar (`...`) no body da requisição — mesmo shape que
   * app/api/contacts/bulk-send-leads/route.ts e
   * app/api/deals/bulk-send-message/route.ts esperam. O motivo de perda
   * "Não respondeu" é definido pelo servidor quando necessário. */
  function serialize(): {
    rmktEnabled: boolean;
    rmktWaves?: RmktWaveInput[];
    noReplyDays?: number;
    markLostOnNoReply: boolean;
  } {
    return {
      rmktEnabled,
      ...(rmktEnabled
        ? {
            rmktWaves: waves.map((w) => ({ dayOffset: Number(w.dayOffset), scriptId: w.scriptId })),
            noReplyDays: resolvedNoReplyDays,
          }
        : {}),
      markLostOnNoReply,
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
    markLostOnNoReply,
    setMarkLostOnNoReply,
    valid,
    serialize,
  };
}

export type UseRmktWavesReturn = ReturnType<typeof useRmktWaves>;
