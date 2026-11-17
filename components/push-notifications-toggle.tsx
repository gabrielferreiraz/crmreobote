"use client";

import { useState } from "react";
import { BellRing, Loader2 } from "lucide-react";
import { usePushSubscription } from "@/lib/use-push-subscription";
import { Toggle } from "./toggle";

export function PushNotificationsToggle() {
  const { status, loading, error, subscribe, unsubscribe } = usePushSubscription();
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function sendTest() {
    setTesting(true);
    setTestMessage(null);
    try {
      const response = await fetch("/api/push/test", { method: "POST" });
      const result = await response.json().catch(() => ({})) as { sent?: number; total?: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível enviar o teste.");
      setTestMessage({
        kind: "success",
        text: `Push enviado para ${result.sent} de ${result.total} dispositivo(s) registrado(s). Confira se apareceu neste computador.`,
      });
    } catch (testError) {
      setTestMessage({ kind: "error", text: testError instanceof Error ? testError.message : "Não foi possível enviar o teste." });
    } finally {
      setTesting(false);
    }
  }

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
    <div className="space-y-3">
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
      {status === "subscribed" && (
        <div className="space-y-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <button type="button" onClick={sendTest} disabled={testing} className="btn-secondary btn-sm">
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
            Enviar push de teste
          </button>
          {testMessage && (
            <p role="status" className={`text-sm ${testMessage.kind === "error" ? "text-red-600 dark:text-red-400" : "text-neutral-600 dark:text-neutral-300"}`}>
              {testMessage.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
