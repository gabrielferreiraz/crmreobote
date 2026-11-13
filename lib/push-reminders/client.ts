"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Confirma leitura quando o conteúdo está visível. Além da montagem, tenta de
 * novo ao voltar para a aba: isso cobre uma tela que já estava aberta quando
 * o push chegou. O servidor é idempotente e só altera lembretes ainda abertos.
 */
export function useAcknowledgePushReminderScope(scopeKey: string): void {
  const inFlight = useRef(false);
  const lastAttemptAt = useRef(0);

  const acknowledge = useCallback(async () => {
    if (document.visibilityState !== "visible" || inFlight.current) return;
    const now = Date.now();
    if (now - lastAttemptAt.current < 15_000) return;
    lastAttemptAt.current = now;
    inFlight.current = true;
    try {
      await fetch("/api/push/reminders/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scopeKey }),
        keepalive: true,
      });
    } catch {
      // Voltar à aba tenta novamente; leitura de lembrete nunca bloqueia a tela.
    } finally {
      inFlight.current = false;
    }
  }, [scopeKey]);

  useEffect(() => {
    lastAttemptAt.current = 0;
    void acknowledge();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void acknowledge();
    };
    const onFocus = () => void acknowledge();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [acknowledge]);
}
