"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, Search } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";

type Source = {
  id: string;
  label: string;
  contactCount: number;
};

export function SourceManager({ initialSources }: { initialSources: Source[] }) {
  const router = useRouter();
  const [sources, setSources] = useState(initialSources);

  // Ressincroniza com o que o servidor mandou depois de um router.refresh()
  // — necessário pro caso de fusão (renomear pra um nome que já existe: a
  // origem antiga é apagada no servidor, ver PATCH /api/lead-sources/[id]),
  // sem isso a entrada renomeada continuaria aparecendo aqui como se ainda
  // existisse até um reload manual da página.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSources(initialSources);
  }, [initialSources]);
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceToDelete, setSourceToDelete] = useState<Source | null>(null);
  const [search, setSearch] = useState("");

  // Mesmo filtro client-side de job-title-manager.tsx — lista já pequena
  // aqui hoje, mas mantém os dois gerenciadores consistentes.
  const filteredSources = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return sources;
    return sources.filter((s) => s.label.toLowerCase().includes(term));
  }, [sources, search]);

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

      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
          strokeWidth={2}
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar origem"
          className="field-input w-full py-1.5 pl-8 text-sm"
        />
      </div>
      {search && (
        <p className="text-xs text-neutral-400 dark:text-neutral-500">
          {filteredSources.length} de {sources.length} origens
        </p>
      )}

      <div className="space-y-2">
        {filteredSources.map((source) => (
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
