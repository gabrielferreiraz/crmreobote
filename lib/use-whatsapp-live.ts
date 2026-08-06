"use client";

import { useEffect, useRef } from "react";

export type WhatsAppLiveEvent =
  | { type: "message"; threadId: string }
  | { type: "status"; threadId: string }
  | { type: "presence"; threadId: string };

/**
 * Assina o canal de eventos ao vivo de WhatsApp (SSE, ver
 * app/api/whatsapp/live/route.ts) — o sinal "algo mudou" que substitui
 * polling de poucos segundos como mecanismo PRINCIPAL de atualização do
 * chat/lista de conversas. `onEvent` decide o que fazer (normalmente:
 * refazer o mesmo fetch que já existia no polling de sempre) — este hook só
 * entrega o aviso, nunca o dado em si (ver lib/whatsapp/live-events.ts).
 *
 * Reconecta sozinho se a conexão cair (comportamento nativo do
 * EventSource — não precisa de lógica de retry aqui). `onEvent` vive numa
 * ref pra não reabrir a conexão a cada re-render do componente que chama
 * isso (uma função inline nova a cada render não deve custar uma conexão
 * SSE nova).
 */
export function useWhatsAppLive(onEvent: (event: WhatsAppLiveEvent) => void): void {
  const onEventRef = useRef(onEvent);
  // Atualiza a ref DEPOIS do render (nunca durante — mutar ref.current no
  // corpo do componente quebra a regra de pureza do React/React Compiler),
  // mas em todo render (sem array de dependências), pra sempre pegar a
  // closure mais recente de `onEvent` sem precisar reabrir a conexão SSE.
  useEffect(() => {
    onEventRef.current = onEvent;
  });

  useEffect(() => {
    if (typeof EventSource === "undefined") return; // SSR/ambiente sem suporte — o polling de segurança cobre
    const source = new EventSource("/api/whatsapp/live");
    source.onmessage = (e) => {
      try {
        onEventRef.current(JSON.parse(e.data) as WhatsAppLiveEvent);
      } catch {
        // Payload inesperado — ignora; o polling de segurança do chamador cobre o resto.
      }
    };
    return () => source.close();
  }, []);
}
