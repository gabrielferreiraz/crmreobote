"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, SearchX, Inbox, GitBranch, Layers, User, Send, Trash2, Loader2, Download, ArrowUp, ArrowDown, ArrowUpDown, CheckCircle2, XCircle } from "lucide-react";
import { formatCurrency, daysSince } from "@/lib/format";
import { STALE_DEAL_ALERT_DAYS } from "@/lib/stale";
import { brazilDateStringToUTC, brazilEndOfDayUTC, brazilStartOfDay } from "@/lib/timezone";
import type { PipelineQuickFilter } from "./pipeline-filters";
import { PipelineQuickFilterButtons } from "./pipeline-quick-filter-buttons";
import { EmptyState } from "@/components/empty-state";
import { Avatar } from "@/components/avatar";
import { FilterPopover } from "@/components/filter-popover";
import { Select } from "@/components/select";
import { DateRangeField } from "@/components/date-range-calendar";
import { SelectionBar } from "@/components/selection-bar";
import { BulkActionPopover } from "@/components/bulk-action-popover";
import { SelectPopoverBody } from "@/components/select-popover-body";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { BulkSendMessageDialog } from "@/components/bulk-send-message-dialog";
import { ClosedAtDialog } from "@/components/closed-at-dialog";
import { LossReasonDialog, type LossReasonOption } from "@/components/loss-reason-dialog";
import { Pagination } from "@/components/pagination";
import { buildListQuickRanges } from "@/lib/date-ranges";
import { countBulkFailures } from "@/lib/bulk-fetch";
import { usePersistedFilters } from "@/lib/use-persisted-filters";
import { sortSelfFirst } from "@/lib/sort-self-first";
import { saveBulkSendDraft, type BulkSendDraft } from "@/lib/pipeline-bulk-send-draft";
import { ESTADOS_BR } from "@/lib/contacts/constants";
import type { Deal } from "./kanban-board";

const QUICK_RANGES = buildListQuickRanges();
const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];
const DEFAULT_PAGE_SIZE = 50;
/** Nenhum negócio de verdade tem esse id de responsável — usado quando o
 * filtro de "responsável X" + "status do consultor" (ativo/inativo) se
 * contradizem (ex.: escolheu um responsável específico E "só inativos", mas
 * esse responsável está ativo), forçando zero resultados sem precisar de um
 * caminho de código separado pra esse caso. */
const IMPOSSIBLE_OWNER_ID = "__none__";

// Precisa bater EXATAMENTE com os valores iniciais dos useState de todo
// filtro/ordenação/pageSize logo abaixo (a mesma forma que captureFilters()
// devolve, + pageSize/noValueOnly/sort/sortDir na mesma ordem que a chamada
// de usePersistedFilters usa) — é contra isso que o filtro restaurado do
// localStorage é comparado pra decidir se a 1ª busca pós-hidratação pode
// ser pulada (ver o efeito de busca principal).
const LISTA_DEFAULT_FILTERS_JSON = JSON.stringify({
  search: "",
  statusFilter: "OPEN",
  ownerFilter: "",
  ownerStatusFilter: "",
  stageFilter: "",
  lossReasonFilter: "",
  jobTitleFilter: "",
  originFilter: "",
  stateFilter: "",
  cityFilter: "",
  dateFrom: "",
  dateTo: "",
  closedFrom: "",
  closedTo: "",
  pageSize: DEFAULT_PAGE_SIZE,
  noValueOnly: false,
  sort: "",
  sortDir: "desc",
});

type MemberOption = { id: string; name: string; active: boolean };
type Stage = { id: string; name: string; color: string | null };
type PipelineOption = { id: string; name: string; stages: { id: string; name: string }[] };
type Sums = { wonSum: number; lostSum: number; totalSum: number };

const STATUS_LABELS: Record<Deal["status"], string> = {
  OPEN: "Em andamento",
  WON: "Ganho",
  LOST: "Perdido",
};

export function DealsList({
  initialDeals,
  initialTotalCount,
  initialSums,
  reloadToken,
  members,
  currentUserId,
  stages,
  pipelineId,
  pipelines,
  lossReasons,
  canBulkDelete,
  canBulkMessage,
  canExport,
  restoredDraft,
  quickFilter,
  onToggleQuickFilter,
  toolbarRight,
}: {
  initialDeals: Deal[];
  /** Total do pipeline inteiro (sem filtro nenhum) na 1ª carga — depois disso, `totalCount` no state reflete o filtro atual. */
  initialTotalCount: number;
  initialSums: Sums;
  /** Incrementado pelo componente pai (novo negócio criado, importação concluída) pra forçar buscar de novo a página/filtro atual. */
  reloadToken: number;
  members: MemberOption[];
  /** Pra "Eu" aparecer sempre em primeiro no filtro de Responsável (ver lib/sort-self-first.ts). */
  currentUserId?: string;
  stages: Stage[];
  pipelineId: string;
  pipelines: PipelineOption[];
  lossReasons: LossReasonOption[];
  canBulkDelete: boolean;
  canBulkMessage: boolean;
  canExport: boolean;
  restoredDraft: BulkSendDraft | null;
  /** Filtro rápido único elevado pra pipeline-view.tsx (ver pipeline-filters.ts) — mesmo que o Kanban usa, sincronizado com a URL. */
  quickFilter: PipelineQuickFilter | null;
  /** Alterna o filtro rápido único — botões Ação hoje/Sem tarefa/Parados +14d
   * na fileira de busca (ver JSX abaixo), mesmo componente que o Kanban usa. */
  onToggleQuickFilter: (value: PipelineQuickFilter) => void;
  /** Kanban/Lista + Importar/Histórico (ver pipeline-view.tsx) — renderizado
   * dentro da MESMA fileira da busca/filtros, não numa linha própria acima:
   * pedido explícito ("na mesma div, não em linhas diferentes"). */
  toolbarRight?: ReactNode;
}) {
  const router = useRouter();

  const [deals, setDeals] = useState(initialDeals);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [sums, setSums] = useState(initialSums);
  const [loading, setLoading] = useState(false);
  // false só durante a janela entre montar e a 1ª busca pós-restauração do
  // localStorage terminar (ver usePersistedFilters abaixo) — sem isso, quem
  // volta pra esta tela com um filtro salvo via localStorage via TODOS os
  // negócios (initialDeals, sem filtro nenhum — o servidor não sabe do
  // localStorage) por um instante, até a busca filtrada terminar e trocar a
  // lista debaixo do usuário. `loading` sozinho não resolve: ele já existia,
  // mas só controla um spinner ao lado da busca — a tabela errada continuava
  // visível por baixo enquanto isso. Uma vez true, nunca mais volta a false
  // (troca de filtro pelo usuário depois mostra loading normalmente, sem
  // esconder a lista antiga — só a 1ª carga precisa desse cuidado extra).
  const [filtersReady, setFiltersReady] = useState(false);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Deal["status"] | "">("OPEN");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [ownerStatusFilter, setOwnerStatusFilter] = useState<"" | "active" | "inactive">("");
  const [stageFilter, setStageFilter] = useState("");
  const [lossReasonFilter, setLossReasonFilter] = useState("");
  const [jobTitleFilter, setJobTitleFilter] = useState("");
  const [originFilter, setOriginFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [noValueOnly, setNoValueOnly] = useState(false);
  // Valor/Data/Parado/Urgência (Valor/Parado/Urgência = mesmo sort do
  // Kanban, ver kanban-board.tsx; Data é só desta Lista, clicável no
  // cabeçalho da tabela) — não sincronizado com a URL de propósito, mesmo
  // raciocínio de lá.
  const [sort, setSort] = useState<"" | "value" | "date" | "stale" | "urgency">("");
  // Só tem efeito de verdade quando `sort` é "value" ou "date" (os dois
  // clicáveis no cabeçalho) — "stale"/"urgency" sempre ordenam do mesmo
  // jeito fixo, e sem sort nenhum ainda define a direção do padrão
  // (stageEnteredAt), ver fetchDealsList.
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  /** Clique no cabeçalho "Data"/"Valor": 1º clique ordena descendente
   * (mais novo/maior primeiro — o que a maioria procura primeiro), clique
   * de novo na MESMA coluna inverte a direção. Clicar numa coluna diferente
   * troca de coluna já começando descendente, não herda a direção da
   * anterior. */
  function toggleColumnSort(column: "value" | "date") {
    if (sort === column) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSort(column);
      setSortDir("desc");
    }
    setPage(1);
  }

  // "Eu" sempre em primeiro no filtro de Responsável.
  const orderedMembers = useMemo(() => sortSelfFirst(members, currentUserId), [members, currentUserId]);
  const [cityFilter, setCityFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [closedFrom, setClosedFrom] = useState("");
  const [closedTo, setClosedTo] = useState("");

  // Debounce só do texto — os demais filtros já resetam a página e buscam na
  // hora (ver os handlers "with reset" abaixo).
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // 1ª renderização já tem os dados certos (vieram prontos do servidor,
  // página 1, sem nenhum destes filtros locais aplicado) — sem essa guarda,
  // esse efeito dispararia uma busca redundante assim que montasse.
  const skipNextFetch = useRef(true);

  // Monta só os parâmetros de FILTRO (sem paginação) — reaproveitado tanto
  // pelo fetch da página quanto pelo link de exportar, pra exportar sempre
  // bater exatamente com o que a tela está mostrando, nunca o pipeline
  // inteiro sem filtro nenhum.
  const buildFilterParams = () => {
    const params = new URLSearchParams({ pipelineId });
    if (debouncedSearch) params.set("q", debouncedSearch);
    if (statusFilter) params.set("status", statusFilter);
    if (ownerFilter && ownerStatusFilter) {
      const isActive = members.find((m) => m.id === ownerFilter)?.active ?? true;
      const matches = ownerStatusFilter === "active" ? isActive : !isActive;
      params.set("ownerId", matches ? ownerFilter : IMPOSSIBLE_OWNER_ID);
    } else if (ownerFilter) {
      params.set("ownerId", ownerFilter);
    } else if (ownerStatusFilter) {
      const ids = members.filter((m) => (ownerStatusFilter === "active" ? m.active : !m.active)).map((m) => m.id);
      params.set("ownerId", ids.length > 0 ? ids.join(",") : IMPOSSIBLE_OWNER_ID);
    }
    if (stageFilter) params.set("stageId", stageFilter);
    if (lossReasonFilter) params.set("lossReasonId", lossReasonFilter);
    if (jobTitleFilter) params.set("jobTitle", jobTitleFilter);
    if (originFilter) params.set("source", originFilter);
    if (stateFilter) params.set("state", stateFilter);
    if (cityFilter) params.set("city", cityFilter);
    if (dateFrom) params.set("createdFrom", brazilDateStringToUTC(dateFrom).toISOString());
    if (dateTo) params.set("createdTo", brazilEndOfDayUTC(dateTo).toISOString());
    if (closedFrom) params.set("closedFrom", brazilDateStringToUTC(closedFrom).toISOString());
    if (closedTo) params.set("closedTo", brazilEndOfDayUTC(closedTo).toISOString());
    if (noValueOnly) params.set("noValue", "1");
    if (sort) params.set("sort", sort);
    if (sortDir !== "desc") params.set("sortDir", sortDir);
    // Filtro rápido único elevado pra pipeline-view.tsx (ver pipeline-filters.ts)
    // — mesma tradução que o Kanban já faz (kanban-board.tsx), pro card
    // "Exige ação" do Início linkar direto pra uma Lista já pré-filtrada.
    switch (quickFilter) {
      case "acao-hoje": {
        const todayStart = brazilStartOfDay(new Date());
        const tomorrowStart = new Date(todayStart.getTime() + 86_400_000);
        params.set("taskDueBefore", tomorrowStart.toISOString());
        break;
      }
      case "sem-tarefa":
        params.set("hasNoOpenTask", "1");
        break;
      case "parados-14d":
        params.set("stageEnteredBefore", new Date(Date.now() - STALE_DEAL_ALERT_DAYS * 86_400_000).toISOString());
        break;
    }
    return params;
  };

  // Lembra o filtro usado da última vez nesta tela (F5, fechar a aba e
  // voltar, ou navegar pra outra tela e voltar) — reaproveita captureFilters/
  // restoreFilters (definidas mais abaixo como function declaration, por
  // isso já dá pra chamar aqui em cima — hoisting; já existiam pro
  // round-trip de "+ Criar script"), só acrescenta pageSize (que aquele par
  // não guarda, por não precisar pra esse outro uso). Precisa vir ANTES do
  // efeito de busca logo abaixo — ele depende de `hydrated`/
  // `persistedFilterValues` pra saber se pode pular a 1ª busca. Ver
  // lib/use-persisted-filters.ts.
  const persistedFilterValues = { ...captureFilters(), pageSize, noValueOnly, sort, sortDir };
  const { hydrated } = usePersistedFilters("pipeline-lista", persistedFilterValues, (saved) => {
    const { pageSize: savedPageSize, noValueOnly: savedNoValueOnly, sort: savedSort, sortDir: savedSortDir, ...filterFields } = saved;
    restoreFilters(filterFields as Record<string, string>);
    if (typeof savedPageSize === "number") setPageSize(savedPageSize);
    if (typeof savedNoValueOnly === "boolean") setNoValueOnly(savedNoValueOnly);
    if (typeof savedSort === "string") setSort(savedSort as typeof sort);
    if (savedSortDir === "asc" || savedSortDir === "desc") setSortDir(savedSortDir);
  });

  // Busca a página/filtro ATUAIS — extraído do efeito principal (logo
  // abaixo) pra também poder ser chamado direto depois de uma ação em massa
  // (apagar/trocar de funil/etapa/responsável). Antes, essas ações só davam
  // router.refresh() — que refaz a consulta do Server Component (page.tsx),
  // mas NUNCA chega a re-sincronizar `deals`/`totalCount`/`sums` aqui: são
  // estado local, inicializado uma vez a partir de `initialDeals` (só na
  // montagem, sem efeito nenhum observando a prop mudar depois) — a tela
  // ficava com as linhas apagadas/desatualizadas até o usuário mexer em
  // algum filtro (o que dispara o efeito principal) ou navegar pra outro
  // lugar e voltar.
  async function fetchCurrentPage(): Promise<{ deals: Deal[]; totalCount: number; sums: Sums } | null> {
    const params = buildFilterParams();
    params.set("skip", String((page - 1) * pageSize));
    params.set("limit", String(pageSize));
    const res = await fetch(`/api/deals?${params.toString()}`);
    if (!res.ok) return null;
    const data: Deal[] = await res.json();
    return {
      deals: data,
      totalCount: Number(res.headers.get("X-Total-Count") ?? data.length),
      sums: {
        wonSum: Number(res.headers.get("X-Won-Sum") ?? 0),
        lostSum: Number(res.headers.get("X-Lost-Sum") ?? 0),
        totalSum: Number(res.headers.get("X-Total-Sum") ?? 0),
      },
    };
  }

  /** Busca de novo e aplica ao state — usado pelas 4 ações em massa abaixo depois de completar. */
  async function refreshCurrentPage() {
    const result = await fetchCurrentPage();
    if (result) {
      setDeals(result.deals);
      setTotalCount(result.totalCount);
      setSums(result.sums);
    }
  }

  useEffect(() => {
    // Espera a restauração do localStorage terminar (ver usePersistedFilters
    // acima) antes de decidir buscar ou não — decidir com base no
    // valor ainda-não-restaurado é o que fazia essa 1ª busca pós-restauração
    // ficar refém de um outro efeito disparar por acaso, deixando a tela
    // presa mostrando os dados SEM filtro até o usuário mexer no filtro de
    // novo manualmente.
    if (!hydrated) return;
    if (skipNextFetch.current) {
      skipNextFetch.current = false;
      // Só pula esta 1ª busca se o que foi restaurado (ou a ausência de
      // qualquer coisa salva) bate exatamente com o que o servidor já usou
      // pra montar initialDeals — senão os dados iniciais (sem filtro local
      // nenhum) ficam desatualizados pra sempre.
      if (JSON.stringify(persistedFilterValues) === LISTA_DEFAULT_FILTERS_JSON) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setFiltersReady(true);
        return;
      }
    }
    let cancelled = false;
    setLoading(true);
    fetchCurrentPage()
      .then((result) => {
        if (cancelled || !result) return;
        setDeals(result.deals);
        setTotalCount(result.totalCount);
        setSums(result.sums);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setFiltersReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hydrated,
    pipelineId,
    page,
    pageSize,
    debouncedSearch,
    statusFilter,
    ownerFilter,
    ownerStatusFilter,
    stageFilter,
    lossReasonFilter,
    jobTitleFilter,
    originFilter,
    stateFilter,
    cityFilter,
    dateFrom,
    dateTo,
    closedFrom,
    closedTo,
    noValueOnly,
    sort,
    sortDir,
    quickFilter,
    reloadToken,
  ]);

  const jobTitleOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of deals) if (d.contact.jobTitle) set.add(d.contact.jobTitle);
    return Array.from(set).sort();
  }, [deals]);

  const originOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of deals) if (d.contact.source) set.add(d.contact.source);
    return Array.from(set).sort();
  }, [deals]);

  const hasFilters =
    statusFilter !== "OPEN" ||
    !!ownerFilter ||
    !!ownerStatusFilter ||
    !!stageFilter ||
    !!lossReasonFilter ||
    !!jobTitleFilter ||
    !!originFilter ||
    !!stateFilter ||
    !!cityFilter ||
    !!dateFrom ||
    !!dateTo ||
    !!closedFrom ||
    !!closedTo ||
    noValueOnly ||
    !!sort ||
    sortDir !== "desc";

  function clearFilters() {
    setStatusFilter("OPEN");
    setOwnerFilter("");
    setOwnerStatusFilter("");
    setStageFilter("");
    setLossReasonFilter("");
    setJobTitleFilter("");
    setOriginFilter("");
    setStateFilter("");
    setCityFilter("");
    setDateFrom("");
    setDateTo("");
    setClosedFrom("");
    setClosedTo("");
    setNoValueOnly(false);
    setSort("");
    setSortDir("desc");
    setPage(1);
  }

  function applyClosedQuickRange(range: { from: string; to: string }) {
    setClosedFrom(range.from);
    setClosedTo(range.to);
    setPage(1);
  }

  // Pra ida-e-volta de "+ Criar script" (ver components/bulk-send-message-dialog.tsx
  // e lib/pipeline-bulk-send-draft.ts) — captura tudo que precisa sobreviver
  // à navegação e restaura de volta.
  function captureFilters(): Record<string, string> {
    return {
      search,
      statusFilter,
      ownerFilter,
      ownerStatusFilter,
      stageFilter,
      lossReasonFilter,
      jobTitleFilter,
      originFilter,
      stateFilter,
      cityFilter,
      dateFrom,
      dateTo,
      closedFrom,
      closedTo,
    };
  }

  function restoreFilters(f: Record<string, string>) {
    if (f.search !== undefined) setSearch(f.search);
    if (f.statusFilter !== undefined) setStatusFilter(f.statusFilter as Deal["status"] | "");
    if (f.ownerFilter !== undefined) setOwnerFilter(f.ownerFilter);
    if (f.ownerStatusFilter !== undefined) setOwnerStatusFilter(f.ownerStatusFilter as "" | "active" | "inactive");
    if (f.stageFilter !== undefined) setStageFilter(f.stageFilter);
    if (f.lossReasonFilter !== undefined) setLossReasonFilter(f.lossReasonFilter);
    if (f.jobTitleFilter !== undefined) setJobTitleFilter(f.jobTitleFilter);
    if (f.originFilter !== undefined) setOriginFilter(f.originFilter);
    if (f.stateFilter !== undefined) setStateFilter(f.stateFilter);
    if (f.cityFilter !== undefined) setCityFilter(f.cityFilter);
    if (f.dateFrom !== undefined) setDateFrom(f.dateFrom);
    if (f.dateTo !== undefined) setDateTo(f.dateTo);
    if (f.closedFrom !== undefined) setClosedFrom(f.closedFrom);
    if (f.closedTo !== undefined) setClosedTo(f.closedTo);
    setPage(1);
  }

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkSendOpen, setBulkSendOpen] = useState(false);
  const [bulkWonOpen, setBulkWonOpen] = useState(false);
  const [bulkLossOpen, setBulkLossOpen] = useState(false);

  // Restaura filtro/seleção depois de voltar de "+ Criar script" e reabre o
  // diálogo de envio sozinho — o script recém-criado já aparece no picker
  // (busca de novo ao abrir, ver BulkSendMessageDialog). restoredDraft só
  // muda uma vez (pipeline-view.tsx faz um pop de uso único), então isso
  // roda no máximo uma vez por sessão de navegação, não em todo re-render.
  useEffect(() => {
    if (!restoredDraft) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    restoreFilters(restoredDraft.filters);
    setSelectedIds(new Set(restoredDraft.selectedIds));
    setBulkSendOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoredDraft]);

  function handleCreateScript() {
    saveBulkSendDraft({ filters: captureFilters(), selectedIds: Array.from(selectedIds) });
    router.push(`/whatsapp/scripts/novo?returnTo=${encodeURIComponent("/pipeline")}`);
  }

  // Seleção opera só sobre a página atual — "selecionar tudo" seleciona no
  // máximo `pageSize` negócios (antes, com "carregar mais", podia acumular
  // milhares na memória; com paginação de verdade não tem mais um superset
  // pra selecionar de outras páginas).
  const allSelected = deals.length > 0 && deals.every((d) => selectedIds.has(d.id));

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const d of deals) next.delete(d.id);
      } else {
        for (const d of deals) next.add(d.id);
      }
      return next;
    });
  }

  function toggleSelect(id: string, shiftKey?: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const isSelecting = !next.has(id);

      if (isSelecting) {
        next.add(id);
      } else {
        next.delete(id);
      }

      if (shiftKey && lastSelectedId && lastSelectedId !== id) {
        const lastIndex = deals.findIndex((d) => d.id === lastSelectedId);
        const currentIndex = deals.findIndex((d) => d.id === id);
        if (lastIndex !== -1 && currentIndex !== -1) {
          const start = Math.min(lastIndex, currentIndex);
          const end = Math.max(lastIndex, currentIndex);
          for (let i = start; i <= end; i++) {
            const dealId = deals[i].id;
            if (isSelecting) {
              next.add(dealId);
            } else {
              next.delete(dealId);
            }
          }
        }
      }

      if (isSelecting) {
        setLastSelectedId(id);
      } else if (lastSelectedId === id) {
        setLastSelectedId(null);
      }

      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setLastSelectedId(null);
    setBulkError(null);
  }

  async function bulkDelete() {
    setBulkBusy(true);
    setBulkError(null);
    try {
      const failures = await countBulkFailures(
        Array.from(selectedIds).map((id) => fetch(`/api/deals/${id}`, { method: "DELETE" })),
      );
      if (failures > 0) {
        setBulkError("Alguns negócios não puderam ser apagados.");
      }
      clearSelection();
      // router.refresh() sozinho não atualiza a tabela (ver comentário em
      // fetchCurrentPage) — busca a página atual de novo pra os negócios
      // apagados somirem na hora.
      await refreshCurrentPage();
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  // Move pra outra pipeline, sempre na primeira etapa dela — trocar de
  // funil E escolher uma etapa específica na mesma ação ficaria complexo
  // demais pro popover; dá pra reposicionar a etapa depois normalmente.
  async function applyBulkPipelineChange(newPipelineId: string) {
    const pipeline = pipelines.find((p) => p.id === newPipelineId);
    if (!pipeline || pipeline.stages.length === 0) return;
    setBulkBusy(true);
    setBulkError(null);
    try {
      const failures = await countBulkFailures(
        Array.from(selectedIds).map((id) =>
          fetch(`/api/deals/${id}/move`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pipelineId: newPipelineId, stageId: pipeline.stages[0].id }),
          }),
        ),
      );
      if (failures > 0) {
        setBulkError("Alguns negócios não puderam ser movidos de funil.");
      }
      clearSelection();
      await refreshCurrentPage();
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  // Etapa dentro da mesma pipeline — pode falhar por negócio (etapa de
  // destino exige valor/tipo de crédito/previsão que aquele negócio ainda
  // não tem), por isso reporta como "alguns" em vez de tudo ou nada.
  async function applyBulkStageChange(newStageId: string) {
    setBulkBusy(true);
    setBulkError(null);
    try {
      const failures = await countBulkFailures(
        Array.from(selectedIds).map((id) =>
          fetch(`/api/deals/${id}/move`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stageId: newStageId }),
          }),
        ),
      );
      if (failures > 0) {
        setBulkError("Alguns negócios não puderam mudar de etapa (a etapa de destino pode exigir algum campo que falta preencher).");
      }
      clearSelection();
      await refreshCurrentPage();
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  async function applyBulkOwnerChange(newOwnerId: string) {
    setBulkBusy(true);
    setBulkError(null);
    try {
      const failures = await countBulkFailures(
        Array.from(selectedIds).map((id) =>
          fetch(`/api/deals/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ownerId: newOwnerId }),
          }),
        ),
      );
      if (failures > 0) {
        setBulkError("Alguns negócios não puderam trocar de responsável.");
      }
      clearSelection();
      await refreshCurrentPage();
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  // Mesmo endpoint/formato que o negócio único usa pra marcar Ganho/Perdido
  // (ver confirmWon/confirmLoss em negocios/[id]/deal-detail.tsx) — só troca
  // o loop de 1 fetch por vários, igual aos outros bulks acima.
  async function applyBulkWon(closedAt: string) {
    setBulkBusy(true);
    setBulkError(null);
    try {
      const failures = await countBulkFailures(
        Array.from(selectedIds).map((id) =>
          fetch(`/api/deals/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "WON", closedAt }),
          }),
        ),
      );
      if (failures > 0) {
        setBulkError("Alguns negócios não puderam ser marcados como ganhos.");
      }
      setBulkWonOpen(false);
      clearSelection();
      await refreshCurrentPage();
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  async function applyBulkLoss(lossReasonId: string, note: string, closedAt: string) {
    setBulkBusy(true);
    setBulkError(null);
    try {
      const failures = await countBulkFailures(
        Array.from(selectedIds).map((id) =>
          fetch(`/api/deals/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "LOST", lossReasonId, lostReason: note || undefined, closedAt }),
          }),
        ),
      );
      if (failures > 0) {
        setBulkError("Alguns negócios não puderam ser marcados como perdidos.");
      }
      setBulkLossOpen(false);
      clearSelection();
      await refreshCurrentPage();
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    // Pipeline é rota "app shell" (ver app-main.tsx/APP_SHELL_ROUTES) — o
    // <main> em volta NUNCA rola (overflow-y-hidden de propósito lá), então
    // essa lista precisa da própria rolagem interna de ponta a ponta, igual
    // o Kanban já faz (ver kanban-board.tsx, mesmo h-full/min-h-0/flex-col
    // aqui em cima + flex-1 min-h-0 overflow-y-auto na região que rola).
    // Antes disso faltava inteiro: a lista virava um bloco comum
    // (space-y-3) que só cresce, sem nenhuma área rolável — com o <main>
    // travado, o que passasse da tela ficava simplesmente inacessível.
    // gap-1.5 (era gap-3) — mesmo ajuste de kanban-board.tsx, consistência
    // entre as duas visões.
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      {/* justify-between com dois grupos (busca/filtros/seleção à esquerda,
          toolbarRight à direita) — mesmo padrão de kanban-board.tsx.
          toolbarRight vem de pipeline-view.tsx (Kanban/Lista + Importar/
          Histórico): pedido explícito pra ficar na MESMA fileira da busca,
          não numa linha própria acima dela. */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2">
        {selectedIds.size > 0 ? (
          // Modo seleção substitui busca/filtros inteiros em vez de somar
          // aos dois (era isso que ficava ruim — as duas coisas espremidas
          // juntas nessa mesma fileira empurravam toolbarRight pra baixo,
          // numa 3ª linha). Reaparecem sozinhas ao limpar a seleção.
          <SelectionBar count={selectedIds.size} onClear={clearSelection}>
            {pipelines.filter((p) => p.id !== pipelineId).length > 0 && (
              <BulkActionPopover icon={GitBranch} label="Trocar de funil">
                {(close) => (
                  <SelectPopoverBody
                    busy={bulkBusy}
                    options={pipelines.filter((p) => p.id !== pipelineId).map((p) => ({ value: p.id, label: p.name }))}
                    onApply={async (v) => { await applyBulkPipelineChange(v); close(); }}
                  />
                )}
              </BulkActionPopover>
            )}
            <BulkActionPopover icon={Layers} label="Trocar de etapa">
              {(close) => (
                <SelectPopoverBody
                  busy={bulkBusy}
                  options={stages.map((s) => ({ value: s.id, label: s.name }))}
                  onApply={async (v) => { await applyBulkStageChange(v); close(); }}
                />
              )}
            </BulkActionPopover>
            <BulkActionPopover icon={User} label="Responsável">
              {(close) => (
                <SelectPopoverBody
                  busy={bulkBusy}
                  options={members.filter((m) => m.active).map((m) => ({ value: m.id, label: m.name }))}
                  onApply={async (v) => { await applyBulkOwnerChange(v); close(); }}
                />
              )}
            </BulkActionPopover>
            <button
              type="button"
              onClick={() => setBulkWonOpen(true)}
              disabled={bulkBusy}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-emerald-600 transition-colors hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
            >
              <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
              Marcar como ganho
            </button>
            <button
              type="button"
              onClick={() => setBulkLossOpen(true)}
              disabled={bulkBusy}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
            >
              <XCircle className="h-3.5 w-3.5" strokeWidth={2} />
              Marcar como perdido
            </button>
            {canBulkMessage && (
              <button
                type="button"
                onClick={() => setBulkSendOpen(true)}
                disabled={bulkBusy}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                <Send className="h-3.5 w-3.5" strokeWidth={2} />
                Enviar mensagem em massa
              </button>
            )}
            {canBulkDelete && (
              <button
                type="button"
                onClick={() => setConfirmBulkDelete(true)}
                disabled={bulkBusy}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                Apagar
              </button>
            )}
          </SelectionBar>
        ) : (
        <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
            strokeWidth={2}
          />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Buscar negócio ou contato"
            className="field-input w-64 py-1.5 pl-8 text-sm"
          />
        </div>
        <FilterPopover active={hasFilters} onClear={clearFilters}>
          <div className="space-y-1">
            <label className="field-label">Status</label>
            <Select
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v as Deal["status"] | "");
                setPage(1);
              }}
              className="w-full py-1.5 text-sm"
              options={[
                { value: "OPEN", label: "Em andamento" },
                { value: "WON", label: "Ganhos" },
                { value: "LOST", label: "Perdidos" },
                { value: "", label: "Todos" },
              ]}
            />
          </div>
          <div className="space-y-1">
            <label className="field-label">Etapa</label>
            <Select
              value={stageFilter}
              onChange={(v) => {
                setStageFilter(v);
                setPage(1);
              }}
              className="w-full py-1.5 text-sm"
              options={[
                { value: "", label: "Todas as etapas" },
                ...stages.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
          </div>
          <div className="space-y-1">
            <label className="field-label">Responsável</label>
            <Select
              value={ownerFilter}
              onChange={(v) => {
                setOwnerFilter(v);
                setPage(1);
              }}
              className="w-full py-1.5 text-sm"
              options={[
                { value: "", label: "Todos os responsáveis" },
                ...orderedMembers.map((m) => ({
                  value: m.id,
                  label: m.id === currentUserId ? "Eu" : m.active ? m.name : `${m.name} (inativo)`,
                })),
              ]}
            />
          </div>
          <div className="space-y-1">
            <label className="field-label">Status do consultor</label>
            <Select
              value={ownerStatusFilter}
              onChange={(v) => {
                setOwnerStatusFilter(v as "" | "active" | "inactive");
                setPage(1);
              }}
              className="w-full py-1.5 text-sm"
              options={[
                { value: "", label: "Ativos e inativos" },
                { value: "active", label: "Somente ativos" },
                { value: "inactive", label: "Somente inativos" },
              ]}
            />
          </div>
          {jobTitleOptions.length > 0 && (
            <div className="space-y-1">
              <label className="field-label">Cargo</label>
              <Select
                value={jobTitleFilter}
                onChange={(v) => {
                  setJobTitleFilter(v);
                  setPage(1);
                }}
                className="w-full py-1.5 text-sm"
                options={[
                  { value: "", label: "Todos os cargos" },
                  ...jobTitleOptions.map((j) => ({ value: j, label: j })),
                ]}
              />
            </div>
          )}
          {originOptions.length > 0 && (
            <div className="space-y-1">
              <label className="field-label">Origem</label>
              <Select
                value={originFilter}
                onChange={(v) => {
                  setOriginFilter(v);
                  setPage(1);
                }}
                className="w-full py-1.5 text-sm"
                options={[
                  { value: "", label: "Todas as origens" },
                  ...originOptions.map((o) => ({ value: o, label: o })),
                ]}
              />
            </div>
          )}
          <div className="space-y-1">
            <label className="field-label">Estado</label>
            <Select
              value={stateFilter}
              onChange={(v) => {
                setStateFilter(v);
                setPage(1);
              }}
              className="w-full py-1.5 text-sm"
              options={[{ value: "", label: "Todos os estados" }, ...ESTADOS_BR]}
            />
          </div>
          <div className="space-y-1">
            <label className="field-label">Cidade</label>
            <input
              value={cityFilter}
              onChange={(e) => {
                setCityFilter(e.target.value);
                setPage(1);
              }}
              placeholder="Buscar por cidade"
              className="field-input w-full py-1.5 text-sm"
            />
          </div>
          {statusFilter === "LOST" && lossReasons.length > 0 && (
            <div className="space-y-1">
              <label className="field-label">Motivo da perda</label>
              <Select
                value={lossReasonFilter}
                onChange={(v) => {
                  setLossReasonFilter(v);
                  setPage(1);
                }}
                className="w-full py-1.5 text-sm"
                options={[
                  { value: "", label: "Todos os motivos" },
                  ...lossReasons.map((r) => ({ value: r.id, label: r.label })),
                ]}
              />
            </div>
          )}
          <div className="space-y-1">
            {/* Mesmo controle de "Valor"/"Data" que já dá pra clicar direto
                no cabeçalho da tabela (desktop) — este dropdown é o único
                jeito de mudar isso no celular, que não tem tabela. Escolher
                aqui sempre reseta a direção pra combinar com o rótulo (ex.:
                "maior primeiro" = descendente) — clicar de novo no cabeçalho
                depois ainda inverte normalmente. */}
            <label className="field-label">Ordenar por</label>
            <Select
              value={sort}
              onChange={(v) => {
                setSort(v as typeof sort);
                setSortDir("desc");
                setPage(1);
              }}
              className="w-full py-1.5 text-sm"
              options={[
                { value: "", label: "Padrão (entrou na etapa)" },
                { value: "value", label: "Valor (maior primeiro)" },
                { value: "date", label: "Data (mais recente primeiro)" },
                { value: "urgency", label: "Urgência (tarefa)" },
                { value: "stale", label: "Parado há mais tempo" },
              ]}
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setNoValueOnly((v) => !v);
              setPage(1);
            }}
            className={`inline-flex w-full items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
              noValueOnly
                ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300"
                : "border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
            }`}
          >
            Sem valor
          </button>
          <div className="space-y-1">
            <label className="field-label">Criado em</label>
            <DateRangeField
              from={dateFrom}
              to={dateTo}
              className="w-full py-1.5 text-sm"
              quickRanges={QUICK_RANGES}
              onSelect={(r) => {
                setDateFrom(r.from);
                setDateTo(r.to);
                setPage(1);
              }}
            />
          </div>
          <div className="space-y-1.5 border-t border-neutral-100 pt-2.5 dark:border-neutral-800">
            <label className="field-label">
              Concluído em <span className="font-normal normal-case text-neutral-400">(ganhos/perdidos)</span>
            </label>
            <DateRangeField
              from={closedFrom}
              to={closedTo}
              className="w-full py-1.5 text-sm"
              quickRanges={QUICK_RANGES}
              onSelect={applyClosedQuickRange}
            />
          </div>
        </FilterPopover>
        <PipelineQuickFilterButtons quickFilter={quickFilter} onToggle={onToggleQuickFilter} />
        {canExport && (
          <a href={`/api/deals/export?${buildFilterParams().toString()}`} className="btn-secondary btn-sm" title="Exporta só os negócios que batem com a busca e os filtros atuais">
            <Download className="h-3.5 w-3.5" strokeWidth={2} />
            Exportar
          </a>
        )}
        {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-neutral-400 dark:text-neutral-500" strokeWidth={2.5} />}
        </div>
        )}
        {toolbarRight}
      </div>
      {bulkError && <p className="shrink-0 text-sm text-red-600 dark:text-red-400">{bulkError}</p>}

      <p className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">
        Ganhos: <span className="font-medium text-neutral-600 dark:text-neutral-300">{formatCurrency(sums.wonSum)}</span> · Perdidos:{" "}
        <span className="font-medium text-neutral-600 dark:text-neutral-300">{formatCurrency(sums.lostSum)}</span>
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto">
      {!filtersReady ? (
        // Ainda esperando a 1ª busca pós-restauração do localStorage (ver
        // filtersReady acima) — evita piscar `initialDeals` (sem o filtro
        // salvo) antes de trocar pra lista filtrada de verdade.
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-neutral-300 dark:text-neutral-700" strokeWidth={2} />
        </div>
      ) : totalCount === 0 ? (
        <div className="card">
          <EmptyState icon={Inbox} title="Nenhum negócio cadastrado" description="Crie o primeiro negócio para começar a preencher o funil." />
        </div>
      ) : deals.length === 0 ? (
        <div className="card">
          <EmptyState icon={SearchX} title="Nenhum negócio encontrado" description="Ajuste a busca ou limpe os filtros." />
        </div>
      ) : (
        <>
          {/* Mobile: cards — a tabela de 9 colunas força rolagem horizontal
              por cima de tudo num celular; aqui cada negócio vira um cartão
              com só o essencial, mesmo padrão de clientes/contacts-table.tsx. */}
          <div className="space-y-2 lg:hidden">
            {deals.map((deal) => (
              <div key={deal.id} className="group card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(deal.id)}
                      onClick={(e) => toggleSelect(deal.id, e.shiftKey)}
                      onChange={() => {}}
                      className={`accent-neutral-900 dark:accent-white ${
                        selectedIds.has(deal.id) ? "" : "opacity-0 group-hover:opacity-100 coarse:opacity-100"
                      }`}
                    />
                    <Link
                      href={`/negocios/${deal.id}`}
                      className="flex min-w-0 items-center gap-1.5 font-medium text-neutral-900 dark:text-neutral-100 hover:underline"
                    >
                      {deal.hasUnreadWhatsApp && (
                        <span className="relative flex h-2 w-2 shrink-0" title="O lead respondeu">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-red-600" />
                        </span>
                      )}
                      <span className="truncate">{deal.name}</span>
                    </Link>
                  </div>
                  <span className="shrink-0 text-sm font-medium tabular-nums text-neutral-900 dark:text-neutral-100">
                    {formatCurrency(deal.value)}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-neutral-500 dark:text-neutral-400">
                  {deal.contact.name}
                  {deal.contact.source && ` · ${deal.contact.source}`}
                  {deal.creditType && ` · ${deal.creditType}`}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 px-2 py-0.5 text-[11px] font-medium text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: deal.stage.color ?? "#999" }} />
                    {deal.stage.name}
                  </span>
                  <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
                    {STATUS_LABELS[deal.status]}
                    {deal.status === "LOST" && (deal.lossReason?.label ?? deal.lostReason) && ` · ${deal.lossReason?.label ?? deal.lostReason}`}
                  </span>
                </div>
                {deal.nextActivity && (
                  <p className="mt-1.5 truncate text-xs text-neutral-400 dark:text-neutral-500">Próxima: {deal.nextActivity}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                  <span className="flex items-center gap-1.5">
                    <Avatar name={deal.owner.name} src={deal.owner.photoUrl} size="xs" />
                    {deal.owner.name}
                  </span>
                  <span>
                    {new Date(deal.status === "OPEN" ? deal.createdAt : (deal.closedAt ?? deal.createdAt)).toLocaleDateString("pt-BR")}
                    {deal.status === "OPEN" &&
                      ` · ${daysSince(deal.stageEnteredAt) === 0 ? "parado hoje" : `${daysSince(deal.stageEnteredAt)}d parado`}`}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: tabela */}
          {/* overflow-y-hidden explícito (não só "sem overflow-x-auto do
              outro eixo") — CSS trata overflow-x não-visible + overflow-y
              visible como os DOIS virando "auto" (mesma regra documentada
              no MDN), então sem isso este card virava sem querer um 2º
              ancestral rolável verticalmente, e o <thead sticky> abaixo
              colava nele (que nunca rola de verdade sozinho) em vez de
              colar no wrapper de fora que realmente rola a lista inteira —
              o cabeçalho ficava "preso" fora do lugar ao rolar. */}
          <div className="card hidden overflow-x-auto overflow-y-hidden lg:block">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-white dark:bg-neutral-900">
                <tr className="border-b border-neutral-200 dark:border-neutral-800 text-left text-neutral-500 dark:text-neutral-400">
                  <th className="px-3 py-2 font-medium">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="accent-neutral-900 dark:accent-white"
                      aria-label="Selecionar todos"
                    />
                  </th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">Negócio</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">Cliente</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">Etapa</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">Status</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">Responsável</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">Próx. atividade</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">
                    <SortableColumnHeader column="date" sort={sort} sortDir={sortDir} onClick={toggleColumnSort}>
                      Data
                    </SortableColumnHeader>
                  </th>
                  <th className="px-3 py-2 text-right font-medium whitespace-nowrap">
                    <SortableColumnHeader column="value" sort={sort} sortDir={sortDir} onClick={toggleColumnSort} align="right">
                      Valor
                    </SortableColumnHeader>
                  </th>
                  <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Parado</th>
                </tr>
              </thead>
              <tbody>
                {deals.map((deal) => (
                  <tr
                    key={deal.id}
                    className="group border-b border-neutral-100 dark:border-neutral-800 last:border-0 hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
                  >
                    <td className="px-3 py-1.5">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(deal.id)}
                        onClick={(e) => toggleSelect(deal.id, e.shiftKey)}
                        onChange={() => {}}
                        className={`accent-neutral-900 dark:accent-white ${
                          selectedIds.has(deal.id) ? "" : "opacity-0 group-hover:opacity-100 coarse:opacity-100"
                        }`}
                      />
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <Link
                        href={`/negocios/${deal.id}`}
                        className="flex items-center gap-1.5 font-medium text-neutral-900 dark:text-neutral-100 hover:underline"
                      >
                        {deal.hasUnreadWhatsApp && (
                          <span className="relative flex h-2 w-2 shrink-0" title="O lead respondeu">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-600" />
                          </span>
                        )}
                        <span>{deal.name}</span>
                        {deal.creditType && (
                          <span className="font-normal text-neutral-400 dark:text-neutral-500">· {deal.creditType}</span>
                        )}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <span className="text-neutral-800 dark:text-neutral-200">{deal.contact.name}</span>
                      {deal.contact.source && (
                        <span className="text-neutral-400 dark:text-neutral-500"> · {deal.contact.source}</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: deal.stage.color ?? "#999" }} />
                        {deal.stage.name}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-neutral-500 dark:text-neutral-400">
                      {STATUS_LABELS[deal.status]}
                      {deal.status === "LOST" && (deal.lossReason?.label ?? deal.lostReason) && (
                        <span className="text-neutral-400 dark:text-neutral-500"> · {deal.lossReason?.label ?? deal.lostReason}</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-neutral-500 dark:text-neutral-400">
                      <span className="flex items-center gap-1.5">
                        <Avatar name={deal.owner.name} src={deal.owner.photoUrl} size="xs" />
                        {deal.owner.name}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-neutral-500 dark:text-neutral-400">{deal.nextActivity ?? "—"}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-neutral-500 dark:text-neutral-400">
                      {new Date(deal.status === "OPEN" ? deal.createdAt : (deal.closedAt ?? deal.createdAt)).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums whitespace-nowrap text-neutral-900 dark:text-neutral-100">
                      {formatCurrency(deal.value)}
                    </td>
                    <td className="px-3 py-1.5 text-right whitespace-nowrap text-neutral-500 dark:text-neutral-400">
                      {deal.status !== "OPEN" ? "—" : daysSince(deal.stageEnteredAt) === 0 ? "hoje" : `${daysSince(deal.stageEnteredAt)} dias`}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-neutral-200 dark:border-neutral-800">
                  <td colSpan={8} className="px-3 py-2 text-right text-xs font-medium text-neutral-400 dark:text-neutral-500">
                    Total filtrado
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums whitespace-nowrap text-neutral-900 dark:text-neutral-100">
                    {formatCurrency(sums.totalSum)}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
      </div>

      <div className="shrink-0">
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
          itemLabel="negócios"
        />
      </div>

      {confirmBulkDelete && (
        <ConfirmDialog
          title={`Apagar ${selectedIds.size} negócio${selectedIds.size === 1 ? "" : "s"}?`}
          description="Essa ação não pode ser desfeita."
          confirmLabel="Apagar"
          onClose={() => setConfirmBulkDelete(false)}
          onConfirm={async () => {
            await bulkDelete();
            setConfirmBulkDelete(false);
          }}
        />
      )}

      {bulkSendOpen && (
        <BulkSendMessageDialog
          dealIds={Array.from(selectedIds)}
          onClose={() => setBulkSendOpen(false)}
          onSent={() => {
            clearSelection();
            router.refresh();
          }}
          onCreateScript={handleCreateScript}
        />
      )}

      {bulkWonOpen && (
        <ClosedAtDialog
          title={`Quando ${selectedIds.size === 1 ? "esse negócio foi ganho" : "esses negócios foram ganhos"}?`}
          confirmLabel="Marcar como ganho"
          confirmClassName="btn-primary bg-emerald-600 hover:bg-emerald-700 focus-visible:ring-emerald-500"
          onClose={() => setBulkWonOpen(false)}
          onConfirm={applyBulkWon}
        />
      )}

      {bulkLossOpen && (
        <LossReasonDialog
          title={`Por que ${selectedIds.size === 1 ? "esse negócio foi perdido" : "esses negócios foram perdidos"}?`}
          lossReasons={lossReasons}
          initialReasonId={null}
          initialNote={null}
          onClose={() => setBulkLossOpen(false)}
          onConfirm={applyBulkLoss}
        />
      )}
    </div>
  );
}

/** Cabeçalho clicável de "Data"/"Valor" — mesmo estado de sort/sortDir do
 * dropdown "Ordenar por" (ver acima), só que direto no lugar onde a coluna
 * já está, sem precisar abrir o popover de filtro. Seta cheia = essa é a
 * coluna ativa (mostra a direção); seta dupla apagada = coluna clicável mas
 * ainda não é a ordenação atual. */
function SortableColumnHeader({
  column,
  sort,
  sortDir,
  onClick,
  align = "left",
  children,
}: {
  column: "value" | "date";
  sort: string;
  sortDir: "asc" | "desc";
  onClick: (column: "value" | "date") => void;
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  const active = sort === column;
  return (
    <button
      type="button"
      onClick={() => onClick(column)}
      className={`inline-flex w-full items-center gap-1 transition-colors hover:text-neutral-900 dark:hover:text-neutral-100 ${
        align === "right" ? "justify-end" : "justify-start"
      } ${active ? "text-neutral-900 dark:text-neutral-100" : ""}`}
    >
      {children}
      {active ? (
        sortDir === "desc" ? (
          <ArrowDown className="h-3 w-3 shrink-0" strokeWidth={2.5} />
        ) : (
          <ArrowUp className="h-3 w-3 shrink-0" strokeWidth={2.5} />
        )
      ) : (
        <ArrowUpDown className="h-3 w-3 shrink-0 opacity-30" strokeWidth={2} />
      )}
    </button>
  );
}
