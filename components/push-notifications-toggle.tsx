"use client";

import { Loader2 } from "lucide-react";
import { usePushSubscription } from "@/lib/use-push-subscription";
import { Toggle } from "./toggle";

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
      {loading ? (
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Notificações push</p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Receba avisos de automações e tarefas mesmo com o CRM fechado.
            </p>
          </div>
          <Loader2 className="h-5 w-5 animate-spin text-neutral-400" strokeWidth={2.5} />
        </div>
      ) : (
        <Toggle
          checked={status === "subscribed"}
          onChange={(checked) => (checked ? subscribe() : unsubscribe())}
          disabled={loading}
          label="Notificações push"
          description="Receba avisos de automações e tarefas mesmo com o CRM fechado."
        />
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
