"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";

type CreditType = {
  id: string;
  label: string;
  dealCount: number;
};

export function CreditTypeManager({ initialCreditTypes }: { initialCreditTypes: CreditType[] }) {
  const router = useRouter();
  const [creditTypes, setCreditTypes] = useState(initialCreditTypes);
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creditTypeToDelete, setCreditTypeToDelete] = useState<CreditType | null>(null);

  async function renameCreditType(id: string, label: string) {
    setCreditTypes((prev) => prev.map((c) => (c.id === id ? { ...c, label } : c)));
    await fetch(`/api/credit-types/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    router.refresh();
  }

  async function deleteCreditType(id: string) {
    setError(null);
    const res = await fetch(`/api/credit-types/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao excluir tipo de crédito");
      return;
    }
    setCreditTypes((prev) => prev.filter((c) => c.id !== id));
    router.refresh();
  }

  async function createCreditType(e: React.FormEvent) {
    e.preventDefault();
    if (!newLabel.trim()) return;
    setCreating(true);
    setError(null);

    const res = await fetch("/api/credit-types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: newLabel }),
    });

    setCreating(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao criar tipo de crédito");
      return;
    }

    const creditType = await res.json();
    setCreditTypes((prev) => [...prev, { ...creditType, dealCount: 0 }]);
    setNewLabel("");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="space-y-2">
        {creditTypes.map((creditType) => (
          <div key={creditType.id} className="card flex items-center gap-2 px-3 py-2">
            <input
              defaultValue={creditType.label}
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (value && value !== creditType.label) renameCreditType(creditType.id, value);
              }}
              className="flex-1 rounded bg-transparent px-1 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:bg-neutral-50 dark:focus:bg-neutral-800"
            />
            <span className="text-xs text-neutral-400 dark:text-neutral-500">{creditType.dealCount} negócios</span>
            <button
              onClick={() => setCreditTypeToDelete(creditType)}
              disabled={creditType.dealCount > 0}
              className="icon-btn hover:text-red-600 dark:hover:text-red-400"
              title={creditType.dealCount > 0 ? "Existem negócios usando este tipo de crédito" : "Excluir tipo de crédito"}
            >
              <Trash2 className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        ))}
      </div>

      <form onSubmit={createCreditType} className="flex gap-2">
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Novo tipo de crédito"
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

      {creditTypeToDelete && (
        <ConfirmDialog
          title={`Excluir o tipo de crédito "${creditTypeToDelete.label}"?`}
          description="Essa ação não pode ser desfeita."
          confirmLabel="Excluir"
          onClose={() => setCreditTypeToDelete(null)}
          onConfirm={async () => {
            await deleteCreditType(creditTypeToDelete.id);
            setCreditTypeToDelete(null);
          }}
        />
      )}
    </div>
  );
}
