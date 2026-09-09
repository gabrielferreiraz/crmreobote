"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Switch } from "@/components/switch";
import { EMAIL_NOTIFICATION_OPTIONS, type EmailNotificationKey } from "@/lib/notification-settings-constants";

export function EmailNotificationsForm({ initial }: { initial: Record<EmailNotificationKey, boolean> }) {
  const [settings, setSettings] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function toggle(key: EmailNotificationKey, value: boolean) {
    const previous = settings;
    // O PUT grava o objeto inteiro (substitui, não faz merge no servidor —
    // ver app/api/organization/email-notifications/route.ts), por isso manda
    // SEMPRE o estado completo aqui, não só a chave que mudou: mandar só
    // `{ [key]: value }` apagaria as outras preferências já salvas.
    const next = { ...settings, [key]: value };
    // Otimista — muda a UI na hora e salva em seguida; desfaz se a API
    // recusar. Cada troca já salva sozinha (sem botão "Salvar" à parte):
    // são só 3 interruptores, não um formulário com vários campos
    // relacionados que precisassem ser confirmados juntos.
    setSettings(next);
    setSaving(true);
    setError(null);
    setSaved(false);

    const res = await fetch("/api/organization/email-notifications", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: next }),
    });

    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao salvar");
      setSettings(previous);
      return;
    }

    setSaved(true);
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="card divide-y divide-neutral-100 p-0 dark:divide-neutral-800">
        {EMAIL_NOTIFICATION_OPTIONS.map((option) => (
          <div key={option.key} className="flex items-start justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="font-medium text-neutral-900 dark:text-neutral-100">{option.label}</p>
              <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">{option.description}</p>
            </div>
            <Switch
              checked={settings[option.key]}
              onChange={(v) => toggle(option.key, v)}
              disabled={saving}
              label={option.label}
            />
          </div>
        ))}
      </div>

      <div className="flex h-5 items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
        {saving && (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />
            Salvando...
          </>
        )}
        {!saving && saved && "Salvo."}
      </div>
    </div>
  );
}
