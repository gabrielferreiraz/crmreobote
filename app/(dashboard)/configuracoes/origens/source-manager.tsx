"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";

type Source = {
  id: string;
  label: string;
  contactCount: number;
};

export function SourceManager({ initialSources }: { initialSources: Source[] }) {
  const router = useRouter();
  const [sources, setSources] = useState(initialSources);
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceToDelete, setSourceToDelete] = useState<Source | null>(null);

  async function renameSource(id: string, label: string) {
    setSources((prev) => prev.map((s) => (s.id === id ? { ...s, label } : s)));
    await fetch(`/api/lead-sources/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    router.refresh();
  }

  async function deleteSource(id: string) {
    setError(null);
    const res = await fetch(`/api/lead-sources/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao excluir origem");
      return;
    }
    setSources((prev) => prev.filter((s) => s.id !== id));
    router.refresh();
  }

  async function createSource(e: React.FormEvent) {
    e.preventDefault();
    if (!newLabel.trim()) return;
    setCreating(true);
    setError(null);

    const res = await fetch("/api/lead-sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: newLabel }),
    });

    setCreating(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao criar origem");
      return;
    }

    const source = await res.json();
    setSources((prev) => [...prev, { ...source, contactCount: 0 }]);
    setNewLabel("");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="space-y-2">
        {sources.map((source) => (
          <div key={source.id} className="card flex items-center gap-2 px-3 py-2">
            <input
              defaultValue={source.label}
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (value && value !== source.label) renameSource(source.id, value);
              }}
              className="flex-1 rounded bg-transparent px-1 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:bg-neutral-50 dark:focus:bg-neutral-800"
            />
            <span className="text-xs text-neutral-400 dark:text-neutral-500">{source.contactCount} contatos</span>
            <button
              onClick={() => setSourceToDelete(source)}
              disabled={source.contactCount > 0}
              className="icon-btn hover:text-red-600 dark:hover:text-red-400"
              title={source.contactCount > 0 ? "Existem contatos usando esta origem" : "Excluir origem"}
            >
              <Trash2 className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        ))}
      </div>

      <form onSubmit={createSource} className="flex gap-2">
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Nova origem"
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

      {sourceToDelete && (
        <ConfirmDialog
          title={`Excluir a origem "${sourceToDelete.label}"?`}
          description="Essa ação não pode ser desfeita."
          confirmLabel="Excluir"
          onClose={() => setSourceToDelete(null)}
          onConfirm={async () => {
            await deleteSource(sourceToDelete.id);
            setSourceToDelete(null);
          }}
        />
      )}
    </div>
  );
}
