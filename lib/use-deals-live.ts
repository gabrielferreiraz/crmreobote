"use client";

import { useEffect, useRef } from "react";

export type DealsLiveEvent = { type: "deal-created"; pipelineId: string };

/**
 * Assina o canal de eventos ao vivo de negócios (SSE, ver
 * app/api/deals/live/route.ts) — cópia de lib/use-whatsapp-live.ts, mesma
 * estrutura. `onEvent` decide o que fazer (normalmente: refazer o mesmo
 * fetch que o Kanban/Lista já fazem ao trocar de filtro) — este hook só
 * entrega o aviso, nunca o negócio em si (ver lib/deals/live-events.ts).
 *
 * Reconecta sozinho se a conexão cair (comportamento nativo do
 * EventSource). `onEvent` vive numa ref pra não reabrir a conexão a cada
 * re-render do componente que chama isso.
 */
export function useDealsLive(onEvent: (event: DealsLiveEvent) => void): void {
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  });

  useEffect(() => {
    if (typeof EventSource === "undefined") return; // SSR/ambiente sem suporte
    const source = new EventSource("/api/deals/live");
    source.onmessage = (e) => {
      try {
        onEventRef.current(JSON.parse(e.data) as DealsLiveEvent);
      } catch {
        // Payload inesperado — ignora.
      }
    };
    return () => source.close();
  }, []);
}
