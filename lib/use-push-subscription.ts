"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export type PushStatus = "checking" | "subscribed" | "unsubscribed" | "unsupported";

type PushSubscriptionState = {
  status: PushStatus;
  loading: boolean;
  error: string | null;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
};

const PushSubscriptionContext = createContext<PushSubscriptionState | null>(null);

async function claimSubscription(subscription: PushSubscriptionJSON): Promise<boolean> {
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint, keys: subscription.keys }),
  });
  return res.ok;
}

/**
 * Mantem uma unica verificacao de Service Worker e uma unica reafirmacao da
 * inscricao push por dashboard. Antes cada menu, sino e aviso repetia esse
 * trabalho ao montar.
 */
export function PushSubscriptionProvider({ children }: { children: ReactNode }) {
  const isSupported =
    typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
  const [status, setStatus] = useState<PushStatus>(isSupported ? "checking" : "unsupported");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupported) return;

    let active = true;
    void (async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js");
        const existing = await registration.pushManager.getSubscription();
        if (existing) await claimSubscription(existing.toJSON()).catch(() => false);
        if (active) setStatus(existing ? "subscribed" : "unsubscribed");
      } catch {
        if (active) setStatus("unsubscribed");
      }
    })();

    return () => {
      active = false;
    };
  }, [isSupported]);

  const subscribe = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) {
        setError("Notificacoes push nao configuradas no servidor.");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError("Permissao negada no navegador.");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const ok = await claimSubscription(subscription.toJSON());
      if (!ok) {
        setError("Erro ao salvar inscricao no servidor.");
        return;
      }
      setStatus("subscribed");
    } catch {
      setError("Nao foi possivel ativar as notificacoes.");
    } finally {
      setLoading(false);
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    if (!isSupported) {
      setStatus("unsupported");
      return;
    }
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
      setError("Nao foi possivel desativar as notificacoes.");
    } finally {
      setLoading(false);
    }
  }, [isSupported]);

  const value = useMemo(
    () => ({ status, loading, error, subscribe, unsubscribe }),
    [status, loading, error, subscribe, unsubscribe],
  );

  return createElement(PushSubscriptionContext.Provider, { value }, children);
}

export function usePushSubscription(): PushSubscriptionState {
  const context = useContext(PushSubscriptionContext);
  if (!context) throw new Error("usePushSubscription requer PushSubscriptionProvider");
  return context;
}
