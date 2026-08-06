"use client";

import { useEffect, useState } from "react";
import { Search, Plus, Loader2, UserRound } from "lucide-react";
import { Modal } from "@/components/modal";
import { LoadingDots } from "@/components/loading-dots";
import { Select } from "@/components/select";
import { formatCurrency } from "@/lib/format";

type DealResult = {
  id: string;
  name: string;
  value: number | null;
  contact: { name: string };
  owner: { name: string };
};

type CategoryOption = { id: string; name: string; pipelines: { id: string; name: string }[] };

/**
 * "Adicionar ao processo" — busca negócios Ganhos que ainda não têm
 * processo (por nome do cliente OU do responsável, ver withoutProcess em
 * lib/deals/list-query.ts), escolhe um, e escolhe a Categoria/Subcategoria
 * de destino. Quem decide isso é o setor de contemplações, não é mais
 * automático quando o negócio é marcado como Ganho.
 */
export function AddToProcessDialog({
  categories,
  defaultPipelineId,
  onClose,
  onCreated,
}: {
  categories: CategoryOption[];
  defaultPipelineId?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DealResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState<DealResult | null>(null);

  const defaultCategory = defaultPipelineId
    ? categories.find((c) => c.pipelines.some((p) => p.id === defaultPipelineId))
    : undefined;
  const [categoryId, setCategoryId] = useState(defaultCategory?.id ?? categories[0]?.id ?? "");
  const [pipelineId, setPipelineId] = useState(defaultPipelineId ?? categories[0]?.pipelines[0]?.id ?? "");

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/processes/available-deals?q=${encodeURIComponent(query)}`);
        if (res.ok && !cancelled) setResults(await res.json());
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query]);

  const pipelineOptions = categories.find((c) => c.id === categoryId)?.pipelines ?? [];

  function handleSelectCategory(id: string) {
    setCategoryId(id);
    const first = categories.find((c) => c.id === id)?.pipelines[0]?.id ?? "";
    setPipelineId(first);
  }

  async function handleAdd() {
    if (!selectedDeal || !pipelineId) return;
    setCreating(true);
    setError(null);

    const res = await fetch("/api/processes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealId: selectedDeal.id, pipelineId }),
    });

    setCreating(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao adicionar ao processo");
      return;
    }

    onCreated();
  }

  return (
    <Modal onClose={onClose} maxWidth="max-w-md">
      <h2 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Adicionar ao processo</h2>
      <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
        Busque um negócio já Ganho pelo nome do cliente ou do responsável.
      </p>

      {!selectedDeal ? (
        <div className="space-y-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
              strokeWidth={2}
            />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nome do cliente ou do responsável"
              className="field-input pl-8"
            />
          </div>

          <div className="max-h-72 space-y-1 overflow-y-auto scrollbar-thin">
            {loading ? (
              <p className="px-2 py-3 text-sm text-neutral-400 dark:text-neutral-500">Buscando...</p>
            ) : query.trim() && results.length === 0 ? (
              <p className="px-2 py-3 text-sm text-neutral-400 dark:text-neutral-500">
                Nenhum negócio Ganho sem processo encontrado.
              </p>
            ) : (
              results.map((deal) => (
                <button
                  key={deal.id}
                  type="button"
                  onClick={() => setSelectedDeal(deal)}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-neutral-900 dark:text-neutral-100">
                      {deal.contact.name}
                    </span>
                    <span className="flex items-center gap-1 truncate text-xs text-neutral-400 dark:text-neutral-500">
                      <UserRound className="h-3 w-3 shrink-0" strokeWidth={2} />
                      {deal.owner.name} · {deal.name}
                    </span>
                  </span>
                  {deal.value != null && (
                    <span className="shrink-0 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                      {formatCurrency(deal.value)}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="card flex items-center justify-between p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                {selectedDeal.contact.name}
              </p>
              <p className="truncate text-xs text-neutral-400 dark:text-neutral-500">
                {selectedDeal.owner.name} · {selectedDeal.name}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedDeal(null)}
              className="shrink-0 text-xs font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              Trocar
            </button>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="field-label">Categoria</label>
              <Select
                value={categoryId}
                onChange={handleSelectCategory}
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
              />
            </div>
            <div className="space-y-1">
              <label className="field-label">Subcategoria</label>
              <Select
                value={pipelineId}
                onChange={setPipelineId}
                placeholder="Selecione"
                options={pipelineOptions.map((p) => ({ value: p.id, label: p.name }))}
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-ghost">
              Cancelar
            </button>
            <button type="button" onClick={handleAdd} disabled={creating || !pipelineId} className="btn-primary">
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
                  <span className="inline-flex items-center gap-1">
                    Adicionando
                    <LoadingDots />
                  </span>
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" strokeWidth={2.5} />
                  Adicionar ao processo
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
