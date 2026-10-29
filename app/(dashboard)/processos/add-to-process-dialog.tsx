"use client";

import { useEffect, useState } from "react";
import { Search, Plus, Loader2, UserRound, UserPlus } from "lucide-react";
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
 * "Adicionar ao processo" — uma busca só resolve os dois casos.
 *
 * Digitando, procura negócios Ganhos ainda sem processo (por nome do cliente
 * OU do responsável, ver withoutProcess em lib/deals/list-query.ts). Achou,
 * escolhe o negócio e segue. Não achou, o texto digitado vira um cliente novo,
 * cadastrado junto com o processo na mesma transação (ver
 * createProcessWithNewContact) — é o caso do contemplado que o administrativo
 * acompanha e que ainda não existe no CRM.
 *
 * O que nenhum dos dois caminhos faz é criar NEGÓCIO: inventar um "ganho" só
 * pra destravar o processo entraria em Vendas do mês, ranking da TV e
 * relatórios como venda que não aconteceu.
 *
 * Em ambos, a Categoria/Subcategoria de destino é escolhida à mão — quem
 * decide isso é o setor de contemplações, não é automático ao ganhar.
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
  /** A busca não achou negócio e a pessoa optou por cadastrar com o texto
   * digitado — daí em diante `query` é o nome do cliente novo, não mais um
   * termo de busca. */
  const [useTypedName, setUseTypedName] = useState(false);
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
    // Uma chamada só, pro próprio endpoint de processos. Com negócio
    // escolhido vai `dealId`; sem negócio vai `clientName`, e o servidor
    // cadastra cliente e processo na mesma transação (ver POST /api/processes).
    const typed = query.trim();
    const payload = selectedDeal ? { dealId: selectedDeal.id, pipelineId } : { clientName: typed, pipelineId };
    if (!selectedDeal && !typed) return;

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
        Busque pelo nome do cliente ou do responsável. Se ninguém aparecer, dá pra cadastrar na hora com o nome que
        você digitou.
      </p>

      {/* Um caminho só: a mesma busca resolve os dois casos. Achou negócio
          Ganho, usa ele; não achou, o próprio texto digitado vira o cliente
          novo (ver o bloco de "nenhum resultado" logo abaixo). */}
      {!selectedDeal && !useTypedName ? (
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
              // Nenhum negócio bateu: em vez de um beco sem saída, o texto
              // digitado vira o cliente novo. É o mesmo caminho de antes, só
              // que oferecido aqui, no momento em que a pessoa descobre que
              // aquele cliente não existe.
              <div className="px-2 py-3">
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  Nenhum negócio Ganho encontrado para <span className="font-medium">{query.trim()}</span>.
                </p>
                <button
                  type="button"
                  onClick={() => setUseTypedName(true)}
                  className="btn-secondary mt-2.5 w-full text-xs"
                >
                  <UserPlus className="h-3.5 w-3.5" strokeWidth={2} />
                  Cadastrar &quot;{query.trim()}&quot; como novo cliente
                </button>
                <p className="mt-1.5 text-xs text-neutral-400 dark:text-neutral-500">
                  Entra no CRM só com o nome — telefone e origem ficam pra depois. Se já existir alguém com esse nome
                  exato, ele é reaproveitado em vez de duplicado.
                </p>
              </div>
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
          {/* Mesmo cartão de confirmação nos dois casos — muda só a legenda:
              com negócio mostra responsável e nome do negócio; sem negócio
              avisa que o cliente será cadastrado. "Trocar" devolve à busca. */}
          <div className="card flex items-center justify-between p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                {selectedDeal ? selectedDeal.contact.name : query.trim()}
              </p>
              <p className="truncate text-xs text-neutral-400 dark:text-neutral-500">
                {selectedDeal ? `${selectedDeal.owner.name} · ${selectedDeal.name}` : "Cliente novo · sem negócio"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedDeal(null);
                setUseTypedName(false);
              }}
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
            <button
              type="button"
              onClick={handleAdd}
              disabled={creating || !pipelineId || (!selectedDeal && !query.trim())}
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
