"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search, MessageSquareWarning, Clock, StickyNote } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/badge";
import { Pagination } from "@/components/pagination";
import { Select } from "@/components/select";
import { formatCurrency } from "@/lib/format";
import { getStageSlaStatus } from "@/lib/processes/sla";
import type { CategoryTreeItem } from "./category-tree-nav";

export type ProcessListItem = {
  id: string;
  pipelineName: string;
  categoryName: string;
  stage: { id: string; name: string; color: string | null; slaBusinessDays: number | null };
  quotaNumber: string | null;
  groupNumber: string | null;
  stageEnteredAt: string | Date;
  contact: { id: string; name: string };
  owner: { id: string; name: string };
  deal: { id: string; name: string; value: number | null };
  openRequestCount: number;
  hasUnreadNote: boolean;
};

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];
const DEFAULT_PAGE_SIZE = 50;

/**
 * Lista de processos cruzando TODAS as Categorias/Subcategorias — o Kanban
 * (ver process-kanban-board.tsx) sempre mostra uma Subcategoria por vez,
 * isto aqui é a visão geral. Mesmo padrão de paginação de verdade de
 * Negócios/Clientes (X-Total-Count no header, nunca "carregar tudo").
 */
export function ProcessList({ categories }: { categories: CategoryTreeItem[] }) {
  const [processes, setProcesses] = useState<ProcessListItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [pipelineId, setPipelineId] = useState("");
  const [loading, setLoading] = useState(true);

  // Só o campo de texto tem debounce (digitar rápido não deve disparar um
  // fetch por tecla) — os filtros de Select já são uma ação discreta só.
  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ skip: String((page - 1) * pageSize), limit: String(pageSize) });
    if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
    if (categoryId) params.set("categoryId", categoryId);
    if (pipelineId) params.set("pipelineId", pipelineId);

    fetch(`/api/processes?${params}`)
      .then(async (res) => {
        const data = (await res.json()) as ProcessListItem[];
        setProcesses(data);
        setTotalCount(Number(res.headers.get("X-Total-Count") ?? data.length));
      })
      .finally(() => setLoading(false));
  }, [page, pageSize, debouncedSearch, categoryId, pipelineId]);

  function handleSearchChange(value: string) {
    setSearch(value);
    setPage(1);
  }

  const pipelineOptions = categories.find((c) => c.id === categoryId)?.pipelines ?? [];

  return (
    // min-h-0: sem isso, o container da lista (flex-1 overflow-y-auto logo
    // abaixo) não consegue calcular altura nenhuma pra rolar por dentro —
    // cresce pro tamanho de todos os itens e empurra a paginação embaixo,
    // fazendo a página inteira rolar em vez de só a lista (ver mesmo ajuste
    // em processes-view.tsx/pipeline-view.tsx).
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-56">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
            strokeWidth={2}
          />
          <input
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Cliente, negócio, cota ou grupo"
            className="field-input w-full pl-8"
          />
        </div>
        <Select
          value={categoryId}
          onChange={(v) => {
            setCategoryId(v);
            setPipelineId("");
            setPage(1);
          }}
          className="w-auto"
          options={[{ value: "", label: "Todas as categorias" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
        />
        <Select
          value={pipelineId}
          onChange={(v) => {
            setPipelineId(v);
            setPage(1);
          }}
          disabled={!categoryId}
          className="w-auto"
          options={[{ value: "", label: "Todas as subcategorias" }, ...pipelineOptions.map((p) => ({ value: p.id, label: p.name }))]}
        />
      </div>

      {/* pb-24 no celular / lg:pb-3 no desktop — mesmo motivo de
          deals-list.tsx: a barra de navegação inferior do celular é fixa,
          fica por cima do conteúdo sem entrar no fluxo, e sem esse respiro
          os últimos processos ficavam escondidos atrás dela mesmo rolando
          até o fim. */}
      <div className={`flex-1 space-y-2 overflow-y-auto pb-24 scrollbar-thin lg:pb-3 ${loading ? "opacity-60" : ""}`}>
        {processes.length === 0 ? (
          <p className="py-10 text-center text-sm text-neutral-400 dark:text-neutral-500">
            Nenhum processo encontrado.
          </p>
        ) : (
          processes.map((p) => {
            const sla = getStageSlaStatus(p.stage, new Date(p.stageEnteredAt));
            return (
            <Link
              key={p.id}
              href={`/processos/${p.id}`}
              className="card flex flex-wrap items-center justify-between gap-3 p-3 text-sm hover:border-neutral-300 dark:hover:border-neutral-700"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar name={p.owner.name} size="xs" />
                <div className="min-w-0">
                  <p className="truncate font-medium text-neutral-900 dark:text-neutral-100">{p.contact.name}</p>
                  <p className="truncate text-xs text-neutral-400 dark:text-neutral-500">
                    {p.categoryName} · {p.pipelineName} · {p.owner.name}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap shrink-0 items-center gap-2">
                {p.hasUnreadNote && (
                  <span
                    title="Anotação nova do administrativo"
                    className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
                  >
                    <StickyNote className="h-3 w-3" strokeWidth={2} />
                    Nova anotação
                  </span>
                )}
                {sla?.overdue && (
                  <Badge tone="danger" size="sm">
                    <Clock className="h-3 w-3" strokeWidth={2} />
                    {sla.daysOverdue}d em atraso
                  </Badge>
                )}
                {p.openRequestCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                    <MessageSquareWarning className="h-3 w-3" strokeWidth={2} />
                    {p.openRequestCount}
                  </span>
                )}
                {p.deal.value != null && (
                  <span className="tabular-nums text-neutral-500 dark:text-neutral-400">
                    {formatCurrency(p.deal.value)}
                  </span>
                )}
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
                  style={{ backgroundColor: `${p.stage.color ?? "#999"}1a`, color: p.stage.color ?? "#666" }}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: p.stage.color ?? "#999" }} />
                  {p.stage.name}
                </span>
              </div>
            </Link>
            );
          })
        )}
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        itemLabel="processos"
      />
    </div>
  );
}
