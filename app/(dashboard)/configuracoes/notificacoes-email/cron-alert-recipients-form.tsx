"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Switch } from "@/components/switch";

type Owner = { id: string; receiveCronAlerts: boolean; user: { id: string; name: string; email: string } };

/**
 * Lista de donos com um interruptor cada — quem recebe o e-mail técnico de
 * "cron parou de rodar" (ver /api/organization/cron-alert-recipients).
 * Independente do interruptor geral "Alertas de cron" logo acima
 * (EmailNotificationsForm) de propósito — são dois componentes client
 * separados sem estado compartilhado, então em vez de esconder esta lista
 * quando o geral está desligado (exigiria levantar estado entre os dois),
 * só avisamos que ela fica sem efeito nesse caso.
 */
export function CronAlertRecipientsForm({ initial }: { initial: Owner[] }) {
  const [owners, setOwners] = useState(initial);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(ownerId: string, value: boolean) {
    const previous = owners;
    setOwners((prev) => prev.map((o) => (o.id === ownerId ? { ...o, receiveCronAlerts: value } : o)));
    setSavingId(ownerId);
    setError(null);

    const res = await fetch("/api/organization/cron-alert-recipients", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationUserId: ownerId, receiveCronAlerts: value }),
    });

    setSavingId(null);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao salvar");
      setOwners(previous);
    }
  }

  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Quem recebe alertas de cron</p>
        <p className="text-xs text-neutral-400 dark:text-neutral-500">
          Só vale com &ldquo;Alertas de cron&rdquo; ligado acima — desligado ali, nenhum dono recebe, mesmo marcado aqui.
        </p>
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="card divide-y divide-neutral-100 p-0 dark:divide-neutral-800">
        {owners.map((owner) => (
          <div key={owner.id} className="flex items-center justify-between gap-4 p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{owner.user.name}</p>
              <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{owner.user.email}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {savingId === owner.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-400" strokeWidth={2.5} />}
              <Switch
                checked={owner.receiveCronAlerts}
                onChange={(v) => toggle(owner.id, v)}
                disabled={savingId === owner.id}
                label={`Alertas de cron para ${owner.user.name}`}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
