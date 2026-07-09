"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

type Status = "checking" | "subscribed" | "unsubscribed";

const isSupported =
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;

export function PushNotificationsToggle() {
  const [status, setStatus] = useState<Status>("checking");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupported) return;

    (async () => {
      const registration = await navigator.serviceWorker.register("/sw.js");
      const existing = await registration.pushManager.getSubscription();
      setStatus(existing ? "subscribed" : "unsubscribed");
    })();
  }, []);

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
        setError("Permissão de notificação negada no navegador.");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });

      const json = subscription.toJSON();
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });

      if (!res.ok) {
        setError("Erro ao salvar inscrição no servidor.");
        return;
      }

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

  if (!isSupported) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        Seu navegador não tem suporte a notificações push.
      </p>
    );
  }

  if (status === "checking") {
    return <p className="text-sm text-neutral-400 dark:text-neutral-500">Verificando…</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Notificações push</p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Receba avisos de automações e tarefas mesmo com o CRM fechado.
          </p>
        </div>
        <button
          onClick={status === "subscribed" ? unsubscribe : subscribe}
          disabled={loading}
          className={status === "subscribed" ? "btn-secondary" : "btn-primary"}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
          ) : status === "subscribed" ? (
            <BellOff className="h-4 w-4" strokeWidth={2} />
          ) : (
            <Bell className="h-4 w-4" strokeWidth={2} />
          )}
          {status === "subscribed" ? "Desativar" : "Ativar"}
        </button>
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
