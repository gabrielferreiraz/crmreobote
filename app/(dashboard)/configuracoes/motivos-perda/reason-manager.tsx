"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";

type Reason = {
  id: string;
  label: string;
  _count: { deals: number };
};

export function ReasonManager({ initialReasons }: { initialReasons: Reason[] }) {
  const router = useRouter();
  const [reasons, setReasons] = useState(initialReasons);
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasonToDelete, setReasonToDelete] = useState<Reason | null>(null);

  async function renameReason(id: string, label: string) {
    setReasons((prev) => prev.map((r) => (r.id === id ? { ...r, label } : r)));
    await fetch(`/api/loss-reasons/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    router.refresh();
  }

  async function deleteReason(id: string) {
    setError(null);
    const res = await fetch(`/api/loss-reasons/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao excluir motivo");
      return;
    }
    setReasons((prev) => prev.filter((r) => r.id !== id));
    router.refresh();
  }

  async function createReason(e: React.FormEvent) {
    e.preventDefault();
    if (!newLabel.trim()) return;
    setCreating(true);
    setError(null);

    const res = await fetch("/api/loss-reasons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: newLabel }),
    });

    setCreating(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao criar motivo");
      return;
    }

    const reason = await res.json();
    setReasons((prev) => [...prev, { ...reason, _count: { deals: 0 } }]);
    setNewLabel("");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="space-y-2">
        {reasons.map((reason) => (
          <div key={reason.id} className="card flex items-center gap-2 px-3 py-2">
            <input
              defaultValue={reason.label}
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (value && value !== reason.label) renameReason(reason.id, value);
              }}
              className="flex-1 rounded bg-transparent px-1 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:bg-neutral-50 dark:focus:bg-neutral-800"
            />
            <span className="text-xs text-neutral-400 dark:text-neutral-500">{reason._count.deals} negócios</span>
            <button
              onClick={() => setReasonToDelete(reason)}
              disabled={reason._count.deals > 0}
              className="icon-btn hover:text-red-600 dark:hover:text-red-400"
              title={
                reason._count.deals > 0
                  ? "Existem negócios usando este motivo"
                  : "Excluir motivo"
              }
            >
              <Trash2 className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        ))}
      </div>

      <form onSubmit={createReason} className="flex gap-2">
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Novo motivo"
          className="field-input flex-1"
        />
        <button type="submit" disabled={creating || !newLabel.trim()} className="btn-primary">
          {creating ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
          ) : (
            <Plus className="h-4 w-4" strokeWidth={2.5} />
          )}
          Adicionar
        </button>
      </form>

      {reasonToDelete && (
        <ConfirmDialog
          title={`Excluir o motivo "${reasonToDelete.label}"?`}
          description="Essa ação não pode ser desfeita."
          confirmLabel="Excluir"
          onClose={() => setReasonToDelete(null)}
          onConfirm={async () => {
            await deleteReason(reasonToDelete.id);
            setReasonToDelete(null);
          }}
        />
      )}
    </div>
  );
}
