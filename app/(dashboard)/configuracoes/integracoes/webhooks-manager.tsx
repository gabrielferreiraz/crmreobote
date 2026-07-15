"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, Trash2, Webhook, History, Pause, Play } from "lucide-react";
import { Modal } from "@/components/modal";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/badge";
import { EmptyState } from "@/components/empty-state";
import { LoadingDots } from "@/components/loading-dots";

type WebhookEventType = "contact.created" | "deal.won" | "deal.lost";

const EVENT_LABELS: Record<WebhookEventType, string> = {
  "contact.created": "Contato criado",
  "deal.won": "Negócio ganho",
  "deal.lost": "Negócio perdido",
};

const ALL_EVENTS: WebhookEventType[] = ["contact.created", "deal.won", "deal.lost"];

type WebhookSubscription = {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdByName: string;
  createdAt: string;
};

export function WebhooksManager({ initialWebhooks }: { initialWebhooks: WebhookSubscription[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<WebhookEventType[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<WebhookSubscription | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<WebhookSubscription | null>(null);

  function toggleEvent(event: WebhookEventType) {
    setSelectedEvents((prev) => (prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]));
  }

  async function createWebhook(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/webhook-subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, events: selectedEvents }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Erro ao criar webhook");
      return;
    }

    setUrl("");
    setSelectedEvents([]);
    setOpen(false);
    setNewSecret(data.secret);
    router.refresh();
  }

  async function toggleActive(webhook: WebhookSubscription) {
    setTogglingId(webhook.id);
    await fetch(`/api/webhook-subscriptions/${webhook.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !webhook.active }),
    });
    setTogglingId(null);
    router.refresh();
  }

  async function deleteWebhook(id: string) {
    await fetch(`/api/webhook-subscriptions/${id}`, { method: "DELETE" });
    setToDelete(null);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={() => setOpen(true)} className="btn-secondary">
          <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
          Novo webhook
        </button>
      </div>

      {initialWebhooks.length === 0 ? (
        <div className="card">
          <EmptyState icon={Webhook} title="Nenhum webhook configurado ainda" />
        </div>
      ) : (
        <div className="card divide-y divide-neutral-100 dark:divide-neutral-800">
          {initialWebhooks.map((w) => (
            <div key={w.id} className={`flex flex-wrap items-center gap-3 p-3 ${w.active ? "" : "opacity-60"}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{w.url}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {w.events.map((e) => (
                    <Badge key={e} tone="neutral">
                      {EVENT_LABELS[e as WebhookEventType] ?? e}
                    </Badge>
                  ))}
                  {!w.active && <Badge tone="warning">Pausado</Badge>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setHistoryFor(w)}
                className="icon-btn shrink-0"
                aria-label="Ver histórico de entregas"
                title="Ver histórico de entregas"
              >
                <History className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
              <button
                type="button"
                disabled={togglingId === w.id}
                onClick={() => toggleActive(w)}
                className="icon-btn shrink-0"
                aria-label={w.active ? "Pausar" : "Ativar"}
                title={w.active ? "Pausar" : "Ativar"}
              >
                {togglingId === w.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />
                ) : w.active ? (
                  <Pause className="h-3.5 w-3.5" strokeWidth={2} />
                ) : (
                  <Play className="h-3.5 w-3.5" strokeWidth={2} />
                )}
              </button>
              <button
                type="button"
                onClick={() => setToDelete(w)}
                className="icon-btn shrink-0 hover:text-red-600 dark:hover:text-red-400"
                aria-label="Excluir webhook"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      )}

      {open && (
        <Modal onClose={() => setOpen(false)} maxWidth="max-w-sm">
          <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Novo webhook</h2>
          <form onSubmit={createWebhook} className="space-y-3">
            <div className="space-y-1">
              <label className="field-label">URL de destino</label>
              <input
                autoFocus
                required
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://hook.us1.make.com/..."
                className="field-input"
              />
            </div>
            <div className="space-y-1.5">
              <label className="field-label">Eventos</label>
              {ALL_EVENTS.map((event) => (
                <label key={event} className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                  <input
                    type="checkbox"
                    checked={selectedEvents.includes(event)}
                    onChange={() => toggleEvent(event)}
                    className="accent-neutral-900 dark:accent-white"
                  />
                  {EVENT_LABELS[event]}
                </label>
              ))}
            </div>

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
                Cancelar
              </button>
              <button type="submit" disabled={loading || !url.trim() || selectedEvents.length === 0} className="btn-primary">
                {loading && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
                {loading ? (
                  <span className="inline-flex items-center gap-1">
                    Criando
                    <LoadingDots />
                  </span>
                ) : (
                  "Criar"
                )}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {newSecret && (
        <Modal onClose={() => setNewSecret(null)} maxWidth="max-w-sm">
          <h2 className="mb-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Webhook criado</h2>
          <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">
            Copie e guarde esse secret agora — ele não será mostrado de novo. Use pra validar a assinatura HMAC
            (header <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">X-CRM-Signature</code>) — ver
            docs/integracoes-api.md.
          </p>
          <div className="flex items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-950">
            <p className="flex-1 font-mono text-sm break-all text-neutral-900 dark:text-neutral-100">{newSecret}</p>
          </div>
          <div className="mt-4 flex justify-end">
            <button onClick={() => setNewSecret(null)} className="btn-primary">
              Fechar
            </button>
          </div>
        </Modal>
      )}

      {toDelete && (
        <ConfirmDialog
          title="Excluir webhook?"
          description="Para de receber notificações nessa URL imediatamente. Não pode ser desfeito."
          confirmLabel="Excluir"
          onClose={() => setToDelete(null)}
          onConfirm={() => deleteWebhook(toDelete.id)}
        />
      )}

      {historyFor && <DeliveryHistoryModal webhook={historyFor} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}

type Delivery = {
  id: string;
  event: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  nextAttemptAt: string;
  createdAt: string;
};

const STATUS_TONE: Record<string, "neutral" | "success" | "danger" | "warning"> = {
  PENDING: "warning",
  SUCCESS: "success",
  FAILED: "danger",
};

function DeliveryHistoryModal({ webhook, onClose }: { webhook: WebhookSubscription; onClose: () => void }) {
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/webhook-subscriptions/${webhook.id}/deliveries`);
      if (cancelled) return;
      if (!res.ok) {
        setError("Não foi possível carregar o histórico.");
        return;
      }
      setDeliveries(await res.json());
    })();
    return () => {
      cancelled = true;
    };
  }, [webhook.id]);

  return (
    <Modal onClose={onClose} maxWidth="max-w-lg">
      <h2 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Histórico de entregas</h2>
      <p className="mb-4 truncate text-sm text-neutral-500 dark:text-neutral-400">{webhook.url}</p>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!error && deliveries === null && <p className="text-sm text-neutral-500 dark:text-neutral-400">Carregando…</p>}
      {deliveries?.length === 0 && <p className="text-sm text-neutral-500 dark:text-neutral-400">Nenhuma entrega ainda.</p>}

      {deliveries && deliveries.length > 0 && (
        <div className="scrollbar-thin max-h-96 space-y-1 overflow-y-auto">
          {deliveries.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800/60">
              <div className="min-w-0">
                <p className="truncate text-neutral-800 dark:text-neutral-200">
                  {EVENT_LABELS[d.event as WebhookEventType] ?? d.event}
                  {d.responseStatus != null && (
                    <span className="ml-1.5 text-xs text-neutral-400 dark:text-neutral-500">HTTP {d.responseStatus}</span>
                  )}
                </p>
                <p className="text-xs text-neutral-400 dark:text-neutral-500">
                  {d.attempts} tentativa{d.attempts === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={STATUS_TONE[d.status] ?? "neutral"}>{d.status}</Badge>
                <span className="text-xs text-neutral-400 dark:text-neutral-500">
                  {new Date(d.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
