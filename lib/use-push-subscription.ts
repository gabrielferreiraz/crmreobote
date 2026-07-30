"use client";

import { useEffect, useState } from "react";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export type PushStatus = "checking" | "subscribed" | "unsubscribed" | "unsupported";

/**
 * Manda o endpoint/chaves pro servidor associar (ou REASSOCIAR) à sessão
 * atual — POST /api/push/subscribe faz upsert por endpoint, sempre gravando
 * o userId de quem chamou. Chamado tanto ao ativar quanto (crucial) toda
 * vez que o hook monta e já encontra uma inscrição existente no navegador.
 */
async function claimSubscription(subscription: PushSubscriptionJSON): Promise<boolean> {
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint, keys: subscription.keys }),
  });
  return res.ok;
}

export function usePushSubscription() {
  const isSupported =
    typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;

  const [status, setStatus] = useState<PushStatus>(isSupported ? "checking" : "unsupported");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupported) return;
    (async () => {
      const registration = await navigator.serviceWorker.register("/sw.js");
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        // Reafirma no servidor que este endpoint é da sessão ATUAL — sem
        // isso, um aparelho compartilhado (loja/computador de equipe) em
        // que a pessoa A ativou push e depois deslogou continuava com a
        // linha no banco apontando pra A; quando B loga no mesmo aparelho,
        // o navegador já está "inscrito" (é o mesmo Service Worker) e B
        // via de fato as notificações de A, sem nunca ter clicado em nada.
        // O upsert do servidor é por endpoint (nunca cria duplicata), então
        // isso só corrige a titularidade — reafirmar de novo pro mesmo
        // usuário de sempre é inofensivo.
        await claimSubscription(existing.toJSON()).catch(() => {});
      }
      setStatus(existing ? "subscribed" : "unsubscribed");
    })();
  }, [isSupported]);

  async function subscribe() {
    setLoading(true);
    setError(null);
    try {
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) {
        setError("Notificações push não configuradas no servidor.");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError("Permissão negada no navegador.");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const ok = await claimSubscription(subscription.toJSON());
      if (!ok) { setError("Erro ao salvar inscrição no servidor."); return; }
      setStatus("subscribed");
    } catch {
      setError("Não foi possível ativar as notificações.");
    } finally {
      setLoading(false);
    }
  }

  async function unsubscribe() {
    setLoading(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setStatus("unsubscribed");
    } catch {
      setError("Não foi possível desativar as notificações.");
    } finally {
      setLoading(false);
    }
  }

  return { status, loading, error, subscribe, unsubscribe };
}
