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

/** De onde o processo nasce.
 *
 * "deal" é o fluxo de sempre: negócio já Ganho, que traz cliente e valor.
 *
 * "avulso" parte de um nome digitado: o cliente é cadastrado junto com o
 * processo, na mesma transação (ver createProcessWithNewContact). Serve pro
 * contemplado que o administrativo acompanha e que ainda não está no CRM. O
 * que ele NÃO cria é negócio — inventar um "ganho" só pra destravar o
 * processo entraria em Vendas do mês, ranking da TV e relatórios como venda
 * que não aconteceu. */
type Source = "deal" | "avulso";

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
  const [source, setSource] = useState<Source>("deal");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DealResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState<DealResult | null>(null);
  /** Nome digitado no modo avulso — vira Process.clientName, e nada mais. */
  const [avulsoName, setAvulsoName] = useState("");

  const defaultCategory = defaultPipelineId
    ? categories.find((c) => c.pipelines.some((p) => p.id === defaultPipelineId))
    : undefined;
  const [categoryId, setCategoryId] = useState(defaultCategory?.id ?? categories[0]?.id ?? "");
  const [pipelineId, setPipelineId] = useState(defaultPipelineId ?? categories[0]?.pipelines[0]?.id ?? "");

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query.trim()) return;
    // Cancela a busca anterior ao digitar de novo — mesmo raciocínio de
    // components/contact-search-input.tsx: economiza a consulta e impede
    // que a resposta de um termo antigo sobrescreva a do termo atual.
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/processes/available-deals?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (res.ok) setResults(await res.json());
      } catch {
        if (!controller.signal.aborted) setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [query]);

  function handleQueryChange(value: string) {
    setQuery(value);
    if (value.trim()) {
      setLoading(true);
    } else {
      setResults([]);
      setLoading(false);
    }
  }

  const pipelineOptions = categories.find((c) => c.id === categoryId)?.pipelines ?? [];

  function handleSelectCategory(id: string) {
    setCategoryId(id);
    const first = categories.find((c) => c.id === id)?.pipelines[0]?.id ?? "";
    setPipelineId(first);
  }

  async function handleAdd() {
    if (!pipelineId) return;
    // Uma chamada só, pro próprio endpoint de processos — nenhum cadastro de
    // cliente acontece antes nem depois (ver POST /api/processes).
    const payload =
      source === "avulso" ? { clientName: avulsoName.trim(), pipelineId } : { dealId: selectedDeal?.id, pipelineId };
    if (source === "avulso" ? !avulsoName.trim() : !selectedDeal) return;

    setCreating(true);
    setError(null);

    const res = await fetch("/api/processes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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
      <p className="mb-3 text-sm text-neutral-500 dark:text-neutral-400">
        {source === "deal"
          ? "Busque um negócio já Ganho pelo nome do cliente ou do responsável."
          : "Digite o nome de quem será acompanhado. O cliente é cadastrado junto, sem precisar de negócio."}
      </p>

      {/* Alternador de origem — os dois caminhos levam ao mesmo endpoint, a
          diferença é só o que vai no corpo (dealId ou clientName). */}
      <div className="mb-4 inline-flex rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-800">
        {(
          [
            ["deal", "De um negócio ganho"],
            ["avulso", "Só o nome"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setSource(value);
              setError(null);
            }}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              source === value
                ? "bg-brand text-white"
                : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {source === "avulso" && (
        <div className="mb-4">
          <label className="field-label" htmlFor="processo-avulso-nome">
            Nome do cliente
          </label>
          <input
            id="processo-avulso-nome"
            autoFocus
            value={avulsoName}
            onChange={(e) => setAvulsoName(e.target.value)}
            placeholder="Ex.: SENEFONTE EMP. IMOBILIARIOS LTDA"
            className="field-input mt-1 w-full"
          />
          <p className="mt-1.5 text-xs text-neutral-400 dark:text-neutral-500">
            O cliente entra no CRM só com o nome — telefone e origem ficam pra depois. Se já existir alguém com esse
            nome exato, ele é reaproveitado em vez de duplicado.
          </p>
        </div>
      )}

      {/* A busca de negócios só existe no modo "deal". No avulso o nome já foi
          digitado acima, então cai direto na escolha de Categoria/Subcategoria
          do bloco de baixo. */}
      {source === "deal" && !selectedDeal ? (
        <div className="space-y-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
              strokeWidth={2}
            />
            <input
              autoFocus
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
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
          {/* O resumo do negócio escolhido não existe no modo avulso — lá não
              há negócio nenhum, só o nome digitado logo acima. */}
          {selectedDeal && (
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
          )}

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
            <button
              type="button"
              onClick={handleAdd}
              disabled={creating || !pipelineId || (source === "avulso" ? !avulsoName.trim() : !selectedDeal)}
              className="btn-primary"
            >
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
