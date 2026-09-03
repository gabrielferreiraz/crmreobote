"use client";

import { useEffect, useState } from "react";

export type WhatsappProvider = "EVOLUTION" | "META_CLOUD" | null;

/**
 * A partir de quantos destinatários um disparo é "muitos" o bastante pra
 * pedir confirmação extra quando o número é Evolution (QR Code) — abaixo
 * disso o risco de banimento não justifica interromper o fluxo com mais um
 * clique. Número redondo escolhido, sem cálculo por trás — ajustável.
 */
export const MANY_RECIPIENTS_THRESHOLD = 20;

/**
 * Provider da instância de WhatsApp conectada da pessoa logada — usado só
 * pra decidir se um disparo em massa (BulkSendMessageDialog/
 * BulkSendConversationsDialog/SendLeadsDialog) precisa de uma confirmação
 * extra antes de mandar de verdade: número conectado via QR Code (Evolution)
 * tem risco real de banimento num disparo grande; número oficial da Meta
 * não. `provider` fica `null` enquanto carrega ou se não tem nada conectado
 * — nesse estado nenhum dos 3 diálogos pede confirmação extra (sem conexão
 * Evolution, não tem o risco que essa confirmação existe pra prevenir).
 */
export function useMyWhatsappProvider(): { provider: WhatsappProvider; loading: boolean } {
  const [provider, setProvider] = useState<WhatsappProvider>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/whatsapp/my-instance")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { provider?: WhatsappProvider } | null) => {
        if (!cancelled) setProvider(data?.provider ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { provider, loading };
}
