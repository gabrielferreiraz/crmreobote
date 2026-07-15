"use client";

import { Loader2, Bell, BellOff } from "lucide-react";
import { usePushSubscription } from "@/lib/use-push-subscription";

export function PushNotificationsToggle() {
  const { status, loading, error, subscribe, unsubscribe } = usePushSubscription();

  if (status === "unsupported") {
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
