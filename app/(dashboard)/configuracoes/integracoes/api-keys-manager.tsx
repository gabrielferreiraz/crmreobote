"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, Trash2, KeyRound } from "lucide-react";
import { Modal } from "@/components/modal";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { TempPasswordDialog } from "@/components/temp-password-dialog";
import { Badge } from "@/components/badge";
import { EmptyState } from "@/components/empty-state";
import { LoadingDots } from "@/components/loading-dots";

type ApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  createdByName: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function ApiKeysManager({ initialKeys }: { initialKeys: ApiKey[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKey | null>(null);

  async function createKey(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Erro ao criar chave");
      return;
    }

    setName("");
    setOpen(false);
    setNewKey(data.fullKey);
    router.refresh();
  }

  async function revokeKey(id: string) {
    await fetch(`/api/api-keys/${id}`, { method: "DELETE" });
    setKeyToRevoke(null);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={() => setOpen(true)} className="btn-secondary">
          <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
          Nova chave
        </button>
      </div>

      {initialKeys.length === 0 ? (
        <div className="card">
          <EmptyState icon={KeyRound} title="Nenhuma chave de API criada ainda" />
        </div>
      ) : (
        <div className="card divide-y divide-neutral-100 dark:divide-neutral-800">
          {initialKeys.map((k) => (
            <div key={k.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {k.name}
                  {k.revokedAt && <Badge tone="neutral">Revogada</Badge>}
                </p>
                <p className="truncate font-mono text-xs text-neutral-500 dark:text-neutral-400">{k.keyPrefix}…</p>
                <p className="text-xs text-neutral-400 dark:text-neutral-500">
                  Criada por {k.createdByName} · último uso {formatDateTime(k.lastUsedAt)}
                </p>
              </div>
              {!k.revokedAt && (
                <button
                  type="button"
                  onClick={() => setKeyToRevoke(k)}
                  className="icon-btn shrink-0 hover:text-red-600 dark:hover:text-red-400"
                  aria-label={`Revogar ${k.name}`}
                  title="Revogar"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {open && (
        <Modal onClose={() => setOpen(false)} maxWidth="max-w-sm">
          <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Nova chave de API</h2>
          <form onSubmit={createKey} className="space-y-3">
            <div className="space-y-1">
              <label className="field-label">Nome</label>
              <input
                autoFocus
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Zapier - lista fria Facebook"
                className="field-input"
              />
            </div>

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
                Cancelar
              </button>
              <button type="submit" disabled={loading || !name.trim()} className="btn-primary">
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

      {newKey && (
        <TempPasswordDialog
          title="Chave criada"
          description="Copie e guarde essa chave agora — ela não será mostrada de novo. Use no header Authorization: Bearer <chave>."
          password={newKey}
          onClose={() => setNewKey(null)}
        />
      )}

      {keyToRevoke && (
        <ConfirmDialog
          title={`Revogar "${keyToRevoke.name}"?`}
          description="Qualquer integração usando essa chave para de funcionar imediatamente. Não pode ser desfeito."
          confirmLabel="Revogar"
          onClose={() => setKeyToRevoke(null)}
          onConfirm={() => revokeKey(keyToRevoke.id)}
        />
      )}
    </div>
  );
}
