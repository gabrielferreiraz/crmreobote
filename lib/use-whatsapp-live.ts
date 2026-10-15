"use client";

import { useEffect, useRef } from "react";

export type WhatsAppLiveEvent =
  | { type: "message"; threadId: string }
  | { type: "status"; threadId: string }
  | { type: "read"; threadId: string }
  | { type: "presence"; threadId: string };

type WhatsAppLiveListener = (event: WhatsAppLiveEvent) => void;

const listeners = new Set<WhatsAppLiveListener>();
let source: EventSource | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

function ensureSource() {
  if (source || typeof EventSource === "undefined") return;

  source = new EventSource("/api/whatsapp/live");
  source.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data) as WhatsAppLiveEvent;
      for (const listener of Array.from(listeners)) listener(payload);
    } catch {
      // O polling de seguranca dos consumidores cobre payloads inesperados.
    }
  };
}

function subscribe(listener: WhatsAppLiveListener) {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }

  listeners.add(listener);
  ensureSource();

  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;

    // Evita abrir outra conexao durante remontagens rapidas do React.
    closeTimer = setTimeout(() => {
      if (listeners.size === 0) {
        source?.close();
        source = null;
      }
      closeTimer = null;
    }, 1_000);
  };
}

/**
 * Assina os eventos ao vivo do WhatsApp. Todos os consumidores da mesma aba
 * compartilham um unico EventSource; lista e chat recebem o mesmo sinal sem
 * manter duas conexoes persistentes com o servidor.
 */
export function useWhatsAppLive(onEvent: (event: WhatsAppLiveEvent) => void): void {
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  });

  useEffect(() => subscribe((event) => onEventRef.current(event)), []);
}
