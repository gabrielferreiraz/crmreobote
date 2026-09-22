"use client";

import { useEffect, useRef } from "react";
import { drainFeatureUsage, restoreFeatureUsage, hasPendingFeatureUsage } from "@/lib/feature-usage/track";

const HEARTBEAT_INTERVAL_MS = 30_000;

// Sem nenhum mouse/toque/tecla por esse tempo = "parado na tela", mesmo com
// a aba em primeiro plano — sem isso, uma aba do CRM esquecida aberta (ex.:
// foi almoçar, foi pra reunião) contava o tempo todo como uso ativo, só
// porque ninguém trocou de aba nem minimizou. Curto o bastante pra refletir
// uso de verdade, longo o bastante pra não penalizar quem só está lendo a
// tela parado (sem clicar/rolar) por um instante.
const IDLE_THRESHOLD_MS = 60_000;

// Cobre mouse, teclado e toque (celular/tablet) — qualquer um desses é
// "a pessoa está de fato na frente da tela agora".
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "touchmove", "scroll", "wheel"] as const;

/**
 * Manda um heartbeat pro servidor a cada 30s enquanto a aba está em
 * primeiro plano E a pessoa interagiu com a tela recentemente (ver
 * lib/user-activity.ts) — alimenta "está online agora" (Configurações →
 * Usuários) e "tempo no CRM" (Relatórios → Atividade da equipe). Pausa
 * quando a aba fica em segundo plano/minimizada OU quando não há nenhuma
 * interação por IDLE_THRESHOLD_MS — nos dois casos, uma aba aberta sem
 * ninguém de fato usando não deve contar como "usando o CRM".
 */
export function PresenceHeartbeat() {
  // Inicializado no efeito (não aqui) — Date.now() é uma chamada impura,
  // não pode rodar durante a renderização (ver regra react-hooks/purity).
  const lastInteractionRef = useRef<number | null>(null);

  useEffect(() => {
    lastInteractionRef.current = Date.now();

    function ping() {
      if (document.visibilityState !== "visible") return;
      if (lastInteractionRef.current === null || Date.now() - lastInteractionRef.current > IDLE_THRESHOLD_MS) return;
      // Leva de carona o que se acumulou de uso de funcionalidade desde o
      // último ping (ver lib/feature-usage/track.ts) — nenhuma requisição
      // nova, só um corpo a mais neste POST que já ia acontecer. Devolve
      // pro buffer se falhar, pra uma queda de rede não apagar a contagem.
      const features = drainFeatureUsage();
      const hasFeatures = Object.keys(features).length > 0;
      fetch("/api/presence/heartbeat", {
        method: "POST",
        ...(hasFeatures
          ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ features }) }
          : {}),
      })
        .then((res) => {
          if (!res.ok && hasFeatures) restoreFeatureUsage(features);
        })
        .catch(() => {
          if (hasFeatures) restoreFeatureUsage(features);
        });
    }

    function markActive() {
      const now = Date.now();
      // Só dispara um ping extra na TRANSIÇÃO parado→ativo (1º movimento
      // depois do período parado) — nas próximas chamadas seguidas (ex.:
      // vários "mousemove" da mesma movimentação), a pessoa já não estava
      // mais "parada" pelo critério acima, então isso não manda um ping por
      // evento, só um por retomada de verdade.
      const wasIdle = lastInteractionRef.current === null || now - lastInteractionRef.current > IDLE_THRESHOLD_MS;
      lastInteractionRef.current = now;
      if (wasIdle) ping();
    }
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, markActive, { passive: true }));

    ping();
    const interval = setInterval(ping, HEARTBEAT_INTERVAL_MS);

    // Ao voltar pra aba depois de um tempo, conta como interação e manda um
    // ping na hora em vez de esperar o próximo tick — senão dava pra passar
    // até 30s "invisível" mesmo já estando de volta ativamente usando o CRM.
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        lastInteractionRef.current = Date.now();
        ping();
        return;
      }
      // Saindo (trocou de aba, minimizou, fechou) — descarrega o buffer de
      // uso de funcionalidade com sendBeacon, o único envio que o navegador
      // garante entregar numa aba que está sumindo (um fetch comum é
      // cancelado junto com a página). Não manda heartbeat de presença aqui
      // de propósito: a pessoa está justamente DEIXANDO a tela, contar isso
      // como tempo ativo seria errado.
      if (!hasPendingFeatureUsage()) return;
      const features = drainFeatureUsage();
      const body = new Blob([JSON.stringify({ features })], { type: "application/json" });
      const sent = navigator.sendBeacon?.("/api/presence/heartbeat", body);
      if (!sent) restoreFeatureUsage(features);
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, markActive));
    };
  }, []);

  return null;
}
