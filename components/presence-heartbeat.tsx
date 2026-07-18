"use client";

import { useEffect } from "react";

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Manda um heartbeat pro servidor a cada 30s enquanto a aba está em
 * primeiro plano (ver lib/user-activity.ts) — alimenta "está online agora"
 * (Configurações → Usuários) e "tempo no CRM" (Relatórios → Atividade da
 * equipe). Pausa quando a aba fica em segundo plano/minimizada — uma aba
 * esquecida aberta não deve contar como "usando o CRM".
 */
export function PresenceHeartbeat() {
  useEffect(() => {
    function ping() {
      if (document.visibilityState !== "visible") return;
      fetch("/api/presence/heartbeat", { method: "POST" }).catch(() => {});
    }

    ping();
    const interval = setInterval(ping, HEARTBEAT_INTERVAL_MS);

    // Ao voltar pra aba depois de um tempo, manda um ping na hora em vez de
    // esperar o próximo tick — senão dava pra passar até 30s "invisível"
    // mesmo já estando de volta ativamente usando o CRM.
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") ping();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return null;
}
