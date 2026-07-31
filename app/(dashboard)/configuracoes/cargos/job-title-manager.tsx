"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, Search } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";

type JobTitle = {
  id: string;
  label: string;
  contactCount: number;
};

export function JobTitleManager({ initialJobTitles }: { initialJobTitles: JobTitle[] }) {
  const router = useRouter();
  const [jobTitles, setJobTitles] = useState(initialJobTitles);

  // Ressincroniza com o que o servidor mandou depois de um router.refresh()
  // — necessário pro caso de fusão (renomear pra um nome que já existe: o
  // cargo antigo é apagado no servidor, ver PATCH /api/job-titles/[id]), sem
  // isso a entrada renomeada continuaria aparecendo aqui como se ainda
  // existisse até um reload manual da página.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setJobTitles(initialJobTitles);
  }, [initialJobTitles]);
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobTitleToDelete, setJobTitleToDelete] = useState<JobTitle | null>(null);
  const [search, setSearch] = useState("");

  // Migração do Agendor trouxe 450 cargos distintos (muita variação de
  // maiúscula/minúscula, sufixo de cidade etc.) — sem busca essa lista fica
  // impossível de navegar pra achar o que corrigir. Filtro client-side puro
  // (a lista inteira já veio do servidor, nada de rede a mais aqui).
  const filteredJobTitles = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return jobTitles;
    return jobTitles.filter((j) => j.label.toLowerCase().includes(term));
  }, [jobTitles, search]);

  async function renameJobTitle(id: string, label: string) {
    setJobTitles((prev) => prev.map((j) => (j.id === id ? { ...j, label } : j)));
    await fetch(`/api/job-titles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    router.refresh();
  }

  async function deleteJobTitle(id: string) {
    setError(null);
    const res = await fetch(`/api/job-titles/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao excluir cargo");
      return;
    }
    setJobTitles((prev) => prev.filter((j) => j.id !== id));
    router.refresh();
  }

  async function createJobTitle(e: React.FormEvent) {
    e.preventDefault();
    if (!newLabel.trim()) return;
    setCreating(true);
    setError(null);

    const res = await fetch("/api/job-titles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: newLabel }),
    });

    setCreating(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao criar cargo");
      return;
    }

    const jobTitle = await res.json();
    setJobTitles((prev) => [...prev, { ...jobTitle, contactCount: 0 }]);
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
          placeholder="Buscar cargo"
          className="field-input w-full py-1.5 pl-8 text-sm"
        />
      </div>
      {search && (
        <p className="text-xs text-neutral-400 dark:text-neutral-500">
          {filteredJobTitles.length} de {jobTitles.length} cargos
        </p>
      )}

      <div className="space-y-2">
        {filteredJobTitles.map((jobTitle) => (
          <div key={jobTitle.id} className="card flex items-center gap-2 px-3 py-2">
            <input
              defaultValue={jobTitle.label}
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (value && value !== jobTitle.label) renameJobTitle(jobTitle.id, value);
              }}
              className="flex-1 rounded bg-transparent px-1 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:bg-neutral-50 dark:focus:bg-neutral-800"
            />
            <span className="text-xs text-neutral-400 dark:text-neutral-500">{jobTitle.contactCount} contatos</span>
            <button
              onClick={() => setJobTitleToDelete(jobTitle)}
              disabled={jobTitle.contactCount > 0}
              className="icon-btn hover:text-red-600 dark:hover:text-red-400"
              title={jobTitle.contactCount > 0 ? "Existem contatos usando este cargo" : "Excluir cargo"}
            >
              <Trash2 className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        ))}
      </div>

      <form onSubmit={createJobTitle} className="flex gap-2">
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Novo cargo"
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

      {jobTitleToDelete && (
        <ConfirmDialog
          title={`Excluir o cargo "${jobTitleToDelete.label}"?`}
          description="Essa ação não pode ser desfeita."
          confirmLabel="Excluir"
          onClose={() => setJobTitleToDelete(null)}
          onConfirm={async () => {
            await deleteJobTitle(jobTitleToDelete.id);
            setJobTitleToDelete(null);
          }}
        />
      )}
    </div>
  );
}
