"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import Link from "next/link";
import { Search, AlertTriangle, Loader2, ArrowUpDown } from "lucide-react";
import { formatCurrency, formatCurrencyCompact, daysSince } from "@/lib/format";
import { isStale, STALE_DEAL_ALERT_DAYS } from "@/lib/stale";
import { brazilStartOfDay } from "@/lib/timezone";
import { Avatar } from "@/components/avatar";
import { Badge, type BadgeTone } from "@/components/badge";
import { FilterPopover } from "@/components/filter-popover";
import { Select } from "@/components/select";
import { usePersistedFilters } from "@/lib/use-persisted-filters";
import { sortSelfFirst } from "@/lib/sort-self-first";
import { classifyTaskUrgency, type TaskUrgency } from "@/lib/task-urgency";
import type { PipelineQuickFilter } from "./pipeline-filters";

type Stage = { id: string; name: string; color: string | null; order: number };

// Mesma paleta compartilhada de components/badge.tsx — Imóvel/Veículo não
// são "bom" ou "ruim", só identidades diferentes, por isso não usam os tons
// de status (success/warning/danger).
const CREDIT_TYPE_TONE: Record<string, BadgeTone> = {
  "IMÓVEL": "success",
  "VEÍCULO": "slate",
};

export type Deal = {
  id: string;
  name: string;
  creditType: string | null;
  value: number | null;
  status: "OPEN" | "WON" | "LOST";
  stageId: string;
  stageEnteredAt: string | Date;
  createdAt: string | Date;
  closedAt: string | Date | null;
  stage: { id: string; name: string; color: string | null };
  contact: { id: string; name: string; source: string | null; jobTitle: string | null };
  owner: { id: string; name: string; photoUrl: string | null };
  nextActivity: string | null;
  taskTypes: string[];
  /** Prazo da mesma tarefa pendente que já vira nextActivity — alimenta a
   * faixa de tarefa do card (ver classifyTaskUrgency em lib/task-urgency.ts). */
  nextTaskDueAt: string | Date | null;
  hasUnreadWhatsApp: boolean;
  lossReasonId: string | null;
  lossReason: { id: string; label: string } | null;
  // Texto livre — é o que a migração do Agendor preenche (não existia
  // motivo estruturado lá). Sempre cair pra ele quando não houver
  // lossReasonId, senão negócio perdido migrado aparece sem motivo nenhum.
  lostReason: string | null;
};

type MemberOption = { id: string; name: string };
type LabelOption = { label: string };

// Referência estável pra etapas sem nenhum negócio carregado — evitar criar
// um array novo a cada render aqui deixa o memo() do StageColumn (ver abaixo)
// de fato pular o re-render dessas colunas quando nada relevante mudou.
const EMPTY_DEALS: Deal[] = [];

// Por coluna, não pro pipeline inteiro — cada etapa busca sua própria página
// (com "Carregar mais" independente) em vez do Kanban buscar o funil OPEN
// inteiro numa consulta só, que não escala com dezenas de milhares de
// negócios reais (ver app/(dashboard)/pipeline/page.tsx pro mesmo tamanho
// usado na 1ª carga, feita no servidor).
const KANBAN_STAGE_PAGE_SIZE = 60;
// Teto da busca inicial/ao trocar filtro — uma consulta só (ver comentário
// em page.tsx sobre por que não é mais uma por etapa), agrupada por etapa no
// cliente depois. Precisa bater com KANBAN_INITIAL_CAP em page.tsx (a mesma
// ideia, só que ali é a carga inicial do servidor).
const KANBAN_INITIAL_CAP = 400;
const SEARCH_DEBOUNCE_MS = 300;

export function KanbanBoard({
  pipelineId,
  stages,
  initialDealsByStage,
  initialCountByStage,
  initialSumByStage,
  initialWithTaskByStage,
  members,
  currentUserId,
  leadSources,
  jobTitles,
  newDeal,
  onNewDealConsumed,
  quickFilter,
}: {
  pipelineId: string;
  stages: Stage[];
  initialDealsByStage: Record<string, Deal[]>;
  initialCountByStage: Record<string, number>;
  /** Soma de valor OPEN por etapa (banco, não só o carregado) — corrige o
   * cabeçalho da coluna, que antes somava só os cards já carregados numa
   * página (errado em qualquer etapa com mais de uma página). */
  initialSumByStage: Record<string, number>;
  /** Quantos negócios de cada etapa têm ao menos uma tarefa pendente —
   * "saúde da etapa" (barra no cabeçalho da coluna). */
  initialWithTaskByStage: Record<string, number>;
  members: MemberOption[];
  currentUserId?: string;
  /** Listas canônicas (Configurações → Origens/Cargos) — as opções do filtro
   * não podem depender só do que já carregou na tela: com paginação por
   * coluna, uma etapa com poucos itens carregados não teria as opções que só
   * aparecem em outra etapa. */
  leadSources: LabelOption[];
  jobTitles: LabelOption[];
  /** Filtro rápido único elevado pra pipeline-view.tsx (Ação hoje/Sem
   * tarefa/Parados +14d), sincronizado com a URL — substitui o antigo toggle
   * local "Só parados". null = nenhum filtro rápido ativo. */
  quickFilter: PipelineQuickFilter | null;
  /** Entrega única de "acabou de criar esse negócio" (ver pipeline-view.tsx)
   * — KanbanBoard é dono do próprio estado por coluna agora, então o pai não
   * pode mais empurrar direto num array. Consumido uma vez (onNewDealConsumed
   * limpa no pai), mesmo padrão do openNewDeal/router.replace já usado nesta
   * tela. */
  newDeal: Deal | null;
  onNewDealConsumed: () => void;
}) {
  const [activeDeal, setActiveDeal] = useState<Deal | null>(null);
  const [pending, setPending] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  // Mouse: começa a arrastar assim que o ponteiro se move um pouco (não
  // precisa segurar). Toque: precisa segurar ~escondido uns 250ms parado —
  // senão TODO arrastar de dedo (inclusive um simples scroll da lista pro
  // lado) virava início de drag, e dava pra rolar o funil no celular.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
  );

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [jobTitleFilter, setJobTitleFilter] = useState("");
  const [noValueOnly, setNoValueOnly] = useState(false);
  // Valor/Parado/Urgência (ver lib/task-urgency.ts) — não sincronizado com a
  // URL de propósito: só o quickFilter (elevado pra pipeline-view.tsx) precisa
  // ser linkável (card "Exige ação" do Início), ordenação é preferência de
  // sessão da tela, não um estado que faça sentido compartilhar por link.
  const [sort, setSort] = useState<"" | "value" | "stale" | "urgency">("");

  const [dealsByStage, setDealsByStage] = useState<Record<string, Deal[]>>(initialDealsByStage);
  const [countByStage, setCountByStage] = useState<Record<string, number>>(initialCountByStage);
  // "Saúde da etapa" — só atualiza numa busca completa (troca de filtro,
  // pipeline ou 1ª carga), nunca durante mover-por-drag/"carregar mais": o
  // ganho de manter essas duas contagens sempre exatas em toda interação
  // otimista não compensa a complexidade (uma coluna que mudou por drag
  // corrige sozinha assim que o usuário troca um filtro ou recarrega).
  const [sumByStage, setSumByStage] = useState<Record<string, number>>(initialSumByStage);
  const [withTaskByStage, setWithTaskByStage] = useState<Record<string, number>>(initialWithTaskByStage);
  const [stagesLoading, setStagesLoading] = useState(false);
  const [loadingMoreStages, setLoadingMoreStages] = useState<Set<string>>(new Set());

  // Ressincroniza quando o pipeline ativo muda (troca de funil no seletor) —
  // page.tsx já busca de novo com o pipeline certo, isso só reflete no client.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDealsByStage(initialDealsByStage);
    setCountByStage(initialCountByStage);
    setSumByStage(initialSumByStage);
    setWithTaskByStage(initialWithTaskByStage);
  }, [initialDealsByStage, initialCountByStage, initialSumByStage, initialWithTaskByStage]);

  // Entrega única do negócio recém-criado (ver comentário na prop acima).
  useEffect(() => {
    if (!newDeal) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDealsByStage((prev) => ({
      ...prev,
      [newDeal.stageId]: [newDeal, ...(prev[newDeal.stageId] ?? [])],
    }));
    setCountByStage((prev) => ({ ...prev, [newDeal.stageId]: (prev[newDeal.stageId] ?? 0) + 1 }));
    onNewDealConsumed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newDeal]);

  // "Eu" sempre em primeiro no filtro de Responsável — acha a si mesmo na
  // hora, sem procurar o próprio nome no meio da lista de consultores.
  const orderedMembers = useMemo(() => sortSelfFirst(members, currentUserId), [members, currentUserId]);

  // Origem/Cargo: lista canônica (Configurações) unida com o que já apareceu
  // na tela — cobre valor "antigo" fora da lista editável sem precisar de
  // uma consulta extra só pra isso. Mesmo raciocínio de contacts-table.tsx.
  const sourceOptions = useMemo(() => {
    const set = new Set(leadSources.map((s) => s.label));
    for (const deals of Object.values(dealsByStage)) {
      for (const d of deals) if (d.contact.source) set.add(d.contact.source);
    }
    return Array.from(set).sort();
  }, [dealsByStage, leadSources]);

  const jobTitleOptions = useMemo(() => {
    const set = new Set(jobTitles.map((j) => j.label));
    for (const deals of Object.values(dealsByStage)) {
      for (const d of deals) if (d.contact.jobTitle) set.add(d.contact.jobTitle);
    }
    return Array.from(set).sort();
  }, [dealsByStage, jobTitles]);

  const hasFilters = !!search || !!ownerFilter || !!sourceFilter || !!jobTitleFilter || noValueOnly || !!sort;

  // Lembra o filtro usado da última vez nesta tela (F5, fechar a aba e
  // voltar, ou navegar pra outra tela e voltar) — ver lib/use-persisted-filters.ts.
  // quickFilter fica de fora de propósito: já vem controlado pela URL (ver
  // pipeline-view.tsx), persistir os dois em paralelo daria dois "últimos
  // valores lembrados" competindo.
  usePersistedFilters(
    "pipeline-kanban",
    { search, ownerFilter, sourceFilter, jobTitleFilter, noValueOnly, sort },
    (saved) => {
      if (saved.search !== undefined) setSearch(saved.search);
      if (saved.ownerFilter !== undefined) setOwnerFilter(saved.ownerFilter);
      if (saved.sourceFilter !== undefined) setSourceFilter(saved.sourceFilter);
      if (saved.jobTitleFilter !== undefined) setJobTitleFilter(saved.jobTitleFilter);
      if (saved.noValueOnly !== undefined) setNoValueOnly(saved.noValueOnly);
      if (saved.sort !== undefined) setSort(saved.sort);
    },
  );

  function clearFilters() {
    setSearch("");
    setOwnerFilter("");
    setSourceFilter("");
    setJobTitleFilter("");
    setNoValueOnly(false);
    setSort("");
  }

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // Mantém os filtros atuais acessíveis fora de um efeito reativo (ver
  // handleLoadMore abaixo) — sem isso, "Carregar mais" precisaria entrar nas
  // dependências do useCallback, e sua identidade mudaria a cada tecla
  // digitada, quebrando o memo() de StageColumn (ver comentário mais abaixo).
  const filtersRef = useRef({ debouncedSearch, ownerFilter, sourceFilter, jobTitleFilter, noValueOnly, sort, quickFilter });
  useEffect(() => {
    filtersRef.current = { debouncedSearch, ownerFilter, sourceFilter, jobTitleFilter, noValueOnly, sort, quickFilter };
  }, [debouncedSearch, ownerFilter, sourceFilter, jobTitleFilter, noValueOnly, sort, quickFilter]);

  // Mesmo motivo do filtersRef acima: handleLoadMore precisa saber quantos
  // negócios cada coluna já tem carregado (pro `skip`) sem depender de
  // dealsByStage no useCallback.
  const dealsByStageRef = useRef(dealsByStage);
  useEffect(() => {
    dealsByStageRef.current = dealsByStage;
  }, [dealsByStage]);

  function buildFilterParams(filters: typeof filtersRef.current) {
    const params = new URLSearchParams();
    params.set("pipelineId", pipelineId);
    params.set("status", "OPEN");
    if (filters.debouncedSearch) params.set("q", filters.debouncedSearch);
    if (filters.ownerFilter) params.set("ownerId", filters.ownerFilter);
    if (filters.sourceFilter) params.set("source", filters.sourceFilter);
    if (filters.jobTitleFilter) params.set("jobTitle", filters.jobTitleFilter);
    if (filters.noValueOnly) params.set("noValue", "1");
    if (filters.sort) params.set("sort", filters.sort);
    // Filtro rápido único elevado pra pipeline-view.tsx (ver pipeline-filters.ts)
    // — traduzido aqui pros mesmos parâmetros que Início/API já entendem.
    switch (filters.quickFilter) {
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
  }

  // 1ª renderização já tem os dados certos (vieram prontos do servidor, sem
  // filtro) — sem essa guarda, esse efeito dispararia uma busca redundante
  // assim que montasse. Se um filtro salvo (usePersistedFilters acima)
  // mudar o estado logo em seguida, o efeito roda de novo com a guarda já
  // desarmada e busca certo.
  const skipNextFetch = useRef(true);

  useEffect(() => {
    if (skipNextFetch.current) {
      skipNextFetch.current = false;
      return;
    }
    let cancelled = false;
    setStagesLoading(true);
    const filters = { debouncedSearch, ownerFilter, sourceFilter, jobTitleFilter, noValueOnly, sort, quickFilter };

    // Duas consultas no total (não uma por coluna) — ver o mesmo motivo em
    // page.tsx: N consultas em paralelo (uma por etapa) chegou a estourar o
    // timeout de transação por operação com o pool de conexões sobrecarregado.
    const dealsParams = buildFilterParams(filters);
    dealsParams.set("take", String(KANBAN_INITIAL_CAP));
    const countsParams = buildFilterParams(filters);

    Promise.all([
      fetch(`/api/deals?${dealsParams.toString()}`).then(async (res) => (res.ok ? ((await res.json()) as Deal[]) : [])),
      fetch(`/api/deals/stage-counts?${countsParams.toString()}`).then(async (res) =>
        res.ok
          ? ((await res.json()) as {
              counts: Record<string, { count: number; sumValue: number }>;
              withTaskCounts: Record<string, number>;
            })
          : { counts: {}, withTaskCounts: {} },
      ),
    ])
      .then(([deals, stageStats]) => {
        if (cancelled) return;
        const byStage: Record<string, Deal[]> = {};
        for (const deal of deals) (byStage[deal.stageId] ??= []).push(deal);
        setDealsByStage(byStage);
        const counts: Record<string, number> = {};
        const sums: Record<string, number> = {};
        for (const [stageId, stats] of Object.entries(stageStats.counts)) {
          counts[stageId] = stats.count;
          sums[stageId] = stats.sumValue;
        }
        setCountByStage(counts);
        setSumByStage(sums);
        setWithTaskByStage(stageStats.withTaskCounts);
      })
      .finally(() => {
        if (!cancelled) setStagesLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, ownerFilter, sourceFilter, jobTitleFilter, noValueOnly, sort, quickFilter, pipelineId]);

  // Identidade estável (deps vazias) — lida com filtros/contagem carregada
  // via ref em vez de closure, pra não recriar a função (e derrubar o
  // memo() de StageColumn) a cada tecla digitada num filtro.
  const handleLoadMore = useCallback(async (stageId: string) => {
    setLoadingMoreStages((prev) => new Set(prev).add(stageId));
    try {
      const params = buildFilterParams(filtersRef.current);
      params.set("stageId", stageId);
      const currentLength = dealsByStageRef.current[stageId]?.length ?? 0;
      params.set("skip", String(currentLength));
      params.set("take", String(KANBAN_STAGE_PAGE_SIZE));
      const res = await fetch(`/api/deals?${params.toString()}`);
      if (!res.ok) return;
      const more: Deal[] = await res.json();
      const total = Number(res.headers.get("X-Total-Count") ?? currentLength + more.length);
      setDealsByStage((prev) => ({ ...prev, [stageId]: [...(prev[stageId] ?? []), ...more] }));
      setCountByStage((prev) => ({ ...prev, [stageId]: total }));
    } finally {
      setLoadingMoreStages((prev) => {
        const next = new Set(prev);
        next.delete(stageId);
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineId]);

  // Backstop robusto: em vez de confiar só em h-full/flex-1/min-h-0 se
  // propagando certo por 4-5 níveis de container até aqui (page → PipelineView
  // → KanbanBoard → fileira de colunas), mede a distância real até o fim da
  // janela e fixa essa altura por CSS — assim a fileira (e cada coluna
  // esticada dentro dela) sempre termina exatamente onde a tela do usuário
  // termina, não importa o que aconteça acima na árvore. Recalcula ao
  // redimensionar a janela.
  const rowRef = useRef<HTMLDivElement>(null);
  const [rowHeight, setRowHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    function measure() {
      const top = el!.getBoundingClientRect().top;
      setRowHeight(Math.max(240, window.innerHeight - top - 4));
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  function handleDragStart(event: DragStartEvent) {
    const stageId = (event.active.data.current as { stageId?: string } | undefined)?.stageId;
    const deal = stageId ? dealsByStage[stageId]?.find((d) => d.id === event.active.id) : undefined;
    setActiveDeal(deal ?? null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveDeal(null);
    if (!over) return;

    const dealId = active.id as string;
    const targetStageId = over.id as string;
    const previousStageId = (active.data.current as { stageId?: string } | undefined)?.stageId;
    if (!previousStageId) return;
    const deal = dealsByStage[previousStageId]?.find((d) => d.id === dealId);
    if (!deal || previousStageId === targetStageId) return;

    setMoveError(null);
    setDealsByStage((prev) => ({
      ...prev,
      [previousStageId]: (prev[previousStageId] ?? []).filter((d) => d.id !== dealId),
      [targetStageId]: [{ ...deal, stageId: targetStageId, stageEnteredAt: new Date() }, ...(prev[targetStageId] ?? [])],
    }));
    setCountByStage((prev) => ({
      ...prev,
      [previousStageId]: Math.max(0, (prev[previousStageId] ?? 1) - 1),
      [targetStageId]: (prev[targetStageId] ?? 0) + 1,
    }));
    setPending(true);

    const res = await fetch(`/api/deals/${dealId}/move`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stageId: targetStageId }),
    });

    setPending(false);

    if (!res.ok) {
      setDealsByStage((prev) => ({
        ...prev,
        [targetStageId]: (prev[targetStageId] ?? []).filter((d) => d.id !== dealId),
        [previousStageId]: [{ ...deal, stageId: previousStageId }, ...(prev[previousStageId] ?? [])],
      }));
      setCountByStage((prev) => ({
        ...prev,
        [targetStageId]: Math.max(0, (prev[targetStageId] ?? 1) - 1),
        [previousStageId]: (prev[previousStageId] ?? 0) + 1,
      }));
      const data = await res.json().catch(() => ({}));
      setMoveError(data.error ?? "Não foi possível mover o negócio");
    }
  }

  return (
    // min-h-0: sem isso, um item flex sem altura mínima explícita nunca
    // encolhe abaixo da altura do próprio conteúdo (o "chão" padrão é
    // min-height:auto). Sem overflow-hidden aqui de propósito — o FilterPopover
    // logo abaixo é `position:absolute` (não portal) e precisa poder flutuar
    // por cima do board; quem corta o conteúdo agora é a fileira de colunas
    // (rowRef, ver abaixo), com altura própria medida da janela, não este
    // container.
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
            strokeWidth={2}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar negócio ou contato"
            className="field-input w-56 py-1.5 pl-8 text-sm"
          />
          {stagesLoading && (
            <Loader2 className="absolute top-1/2 right-2.5 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-neutral-400 dark:text-neutral-500" />
          )}
        </div>
        <FilterPopover active={hasFilters} onClear={clearFilters}>
          <div className="space-y-1">
            <label className="field-label">Responsável</label>
            <Select
              value={ownerFilter}
              onChange={setOwnerFilter}
              className="w-full py-1.5 text-sm"
              options={[
                { value: "", label: "Todos os responsáveis" },
                ...orderedMembers.map((m) => ({ value: m.id, label: m.id === currentUserId ? "Eu" : m.name })),
              ]}
            />
          </div>
          {sourceOptions.length > 0 && (
            <div className="space-y-1">
              <label className="field-label">Origem</label>
              <Select
                value={sourceFilter}
                onChange={setSourceFilter}
                className="w-full py-1.5 text-sm"
                options={[
                  { value: "", label: "Todas as origens" },
                  ...sourceOptions.map((s) => ({ value: s, label: s })),
                ]}
              />
            </div>
          )}
          {jobTitleOptions.length > 0 && (
            <div className="space-y-1">
              <label className="field-label">Cargo</label>
              <Select
                value={jobTitleFilter}
                onChange={setJobTitleFilter}
                className="w-full py-1.5 text-sm"
                options={[
                  { value: "", label: "Todos os cargos" },
                  ...jobTitleOptions.map((j) => ({ value: j, label: j })),
                ]}
              />
            </div>
          )}
          <div className="space-y-1">
            <label className="field-label">Ordenar por</label>
            <Select
              value={sort}
              onChange={(v) => setSort(v as typeof sort)}
              className="w-full py-1.5 text-sm"
              options={[
                { value: "", label: "Padrão (entrou na etapa)" },
                { value: "value", label: "Valor (maior primeiro)" },
                { value: "urgency", label: "Urgência (tarefa)" },
                { value: "stale", label: "Parado há mais tempo" },
              ]}
            />
          </div>
          <button
            onClick={() => setNoValueOnly((v) => !v)}
            className={`inline-flex w-full items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
              noValueOnly
                ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300"
                : "border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />
            Sem valor
          </button>
        </FilterPopover>
      </div>

      {moveError && (
        <p className="shrink-0 text-xs text-red-600 dark:text-red-400">{moveError}</p>
      )}

      <DndContext
        id="kanban-board"
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div
          ref={rowRef}
          // flex: "0 0 auto" trava a altura no valor medido (rowHeight) —
          // sem isso, a classe flex-1 (flex-basis:0%, grow:1) ainda manda no
          // tamanho de verdade e o height inline vira só sugestão, ignorada
          // pelo algoritmo de flex-grow. Só troca depois de medir (1ª
          // pintura já mede antes de exibir, useLayoutEffect); antes disso
          // continua flex-1 como fallback.
          style={rowHeight != null ? { height: rowHeight, flex: "0 0 auto" } : undefined}
          className="scrollbar-thin flex min-h-0 flex-1 gap-4 overflow-x-auto pb-4"
        >
          {stages.map((stage) => (
            <StageColumn
              key={stage.id}
              stage={stage}
              deals={dealsByStage[stage.id] ?? EMPTY_DEALS}
              total={countByStage[stage.id] ?? dealsByStage[stage.id]?.length ?? 0}
              sumValue={sumByStage[stage.id] ?? 0}
              withTaskCount={withTaskByStage[stage.id] ?? 0}
              loadingMore={loadingMoreStages.has(stage.id)}
              onLoadMore={handleLoadMore}
              disabled={pending}
              activeDealId={activeDeal?.id ?? null}
            />
          ))}
        </div>
        <DragOverlay>{activeDeal ? <DealCard deal={activeDeal} overlay /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}

// Altura estimada de um DealCard renderizado + o espaço entre cartões
// (CARD_GAP, ver uso abaixo — trocado por padding-bottom já que os cartões
// agora são posicionados de forma absoluta) — os cartões têm conteúdo
// compacto e sempre a mesma estrutura de linhas (nome+avatar, contato+
// crédito, faixa de tarefa, valor+dias), então a altura real varia muito
// pouco e uma estimativa fixa é suficiente pra virtualizar sem precisar medir
// cada um. Base subiu de 108→132 (redesign trocou a fileira de ícones de
// tarefa por uma faixa com borda+padding, mais alta) — o valor antigo deixava
// o espaçamento real MENOR que o CARD_GAP configurado (cartões quase
// encostando um no outro, cada slot só cabia o próprio conteúdo sem sobrar
// nada pro respiro), já que a posição de cada cartão é calculada por slot
// fixo (i * ROW_HEIGHT), não pela altura de verdade do cartão anterior.
const CARD_GAP = 28;
const ROW_HEIGHT = 132 + CARD_GAP;
// Linhas extras montadas acima/abaixo da área visível — sem essa margem, um
// scroll rápido mostraria um instante de coluna vazia antes do próximo lote
// de cartões terminar de montar.
const OVERSCAN = 6;
// A que distância (em px) do fim do conteúdo já carregado disparar a busca
// do próximo lote — sem botão de "carregar mais": ao chegar perto do fim de
// uma coluna rolando, o próximo lote já é buscado sozinho, silenciosamente,
// antes mesmo do usuário perceber que tinha um limite ali. ~3 cartões de
// antecedência é suficiente pra cobrir o tempo do fetch antes de sobrar tela
// vazia embaixo.
const LOAD_MORE_THRESHOLD_PX = ROW_HEIGHT * 3;

// memo: cada arrasto muda `activeDeal`/`pending` no componente pai — sem
// isso, TODAS as colunas re-renderizavam a cada movimento do mouse durante o
// drag, mesmo as que não têm nenhum negócio envolvido (o `deals` de cada
// coluna só muda identidade quando o fetch dessa etapa termina ou um negócio
// é criado/movido de/pra ela — ver KanbanBoard acima). `onLoadMore` tem
// identidade estável (useCallback com deps vazias) de propósito, senão
// derrubaria esse memo a cada tecla digitada num filtro.
const StageColumn = memo(function StageColumn({
  stage,
  deals,
  total,
  sumValue,
  withTaskCount,
  loadingMore,
  onLoadMore,
  disabled,
  activeDealId,
}: {
  stage: Stage;
  deals: Deal[];
  total: number;
  /** Soma de valor OPEN de TODA a etapa (banco) — não só os cards carregados. */
  sumValue: number;
  /** Quantos negócios da etapa têm ao menos uma tarefa pendente — "saúde da etapa". */
  withTaskCount: number;
  loadingMore: boolean;
  onLoadMore: (stageId: string) => void;
  disabled: boolean;
  activeDealId: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id, disabled });
  const hasMore = deals.length < total;
  // Saúde da etapa: % de negócios com tarefa pendente — verde ≥60%, âmbar
  // ≥30%, vermelho abaixo disso (ver new-design-for-claude/README.md).
  const healthPct = total > 0 ? Math.round((withTaskCount / total) * 100) : null;
  const healthColor = healthPct === null ? "" : healthPct >= 60 ? "bg-emerald-500" : healthPct >= 30 ? "bg-amber-500" : "bg-red-500";

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  // Chute inicial generoso (em vez de 0) pra já mostrar um lote de cartões no
  // primeiro render, sem esperar o ResizeObserver medir a coluna de verdade —
  // ele corrige o valor logo em seguida, o chute só evita uma coluna vazia
  // por um instante.
  const [viewportHeight, setViewportHeight] = useState(640);

  // useLayoutEffect (não useEffect): mede antes do navegador pintar, senão a
  // 1ª pintura usa o chute de 640px e pode mostrar cartão a mais/a menos por
  // um frame até o valor real chegar.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewportHeight(el.clientHeight);
    const observer = new ResizeObserver(() => setViewportHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // rAF em vez de atualizar o state a cada evento de scroll direto — um
  // scroll rápido dispara dezenas de eventos por segundo, e sem isso cada um
  // vira um re-render da coluna inteira + todo cartão visível. Coalescendo
  // pro próximo frame, no máximo 1 re-render por frame pintado.
  const scrollRaf = useRef<number | null>(null);

  // Trava local pra não disparar o mesmo "carregar mais" várias vezes
  // seguidas enquanto a busca ainda está em voo (o prop `loadingMore` só
  // reflete isso um render depois, tempo suficiente pra vários eventos de
  // scroll passarem pelo threshold antes dele virar `true`). Destrava assim
  // que um lote novo realmente chega (deals.length muda).
  const loadMoreRequestedRef = useRef(false);
  useEffect(() => {
    loadMoreRequestedRef.current = false;
  }, [deals.length]);

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      const top = el.scrollTop;
      if (scrollRaf.current != null) cancelAnimationFrame(scrollRaf.current);
      scrollRaf.current = requestAnimationFrame(() => setScrollTop(top));

      if (hasMore && !loadingMore && !loadMoreRequestedRef.current) {
        const distanceToBottom = el.scrollHeight - (top + el.clientHeight);
        if (distanceToBottom < LOAD_MORE_THRESHOLD_PX) {
          loadMoreRequestedRef.current = true;
          onLoadMore(stage.id);
        }
      }
    },
    [hasMore, loadingMore, onLoadMore, stage.id],
  );
  useLayoutEffect(() => {
    return () => {
      if (scrollRaf.current != null) cancelAnimationFrame(scrollRaf.current);
    };
  }, []);

  // Só monta no DOM os cartões (com listener de drag, avatar etc.) que estão
  // dentro ou perto da área visível da coluna — sem isso, uma etapa com
  // milhares de negócios montava todos de uma vez, mesmo os que nunca
  // aparecem na tela sem rolar, travando o scroll e gastando memória à toa.
  const rawStartIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const rawEndIndex = Math.min(deals.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);
  // O dnd-kit rola automaticamente a coluna quando se arrasta um cartão perto
  // da borda (autoScroll, ligado por padrão) — sem isso, o próprio cartão
  // sendo arrastado podia sair da janela virtualizada e desmontar no meio do
  // arrasto. Alarga a janela (nunca encolhe) pra sempre incluir o índice dele.
  const activeIndex = activeDealId ? deals.findIndex((d) => d.id === activeDealId) : -1;
  const startIndex = activeIndex >= 0 ? Math.min(rawStartIndex, activeIndex) : rawStartIndex;
  const endIndex = activeIndex >= 0 ? Math.max(rawEndIndex, activeIndex + 1) : rawEndIndex;
  const visibleDeals = deals.slice(startIndex, endIndex);

  return (
    <div
      ref={setNodeRef}
      className={`flex w-64 min-h-0 shrink-0 flex-col rounded-lg border bg-neutral-100/50 dark:bg-neutral-800/40 transition-colors ${
        isOver ? "border-neutral-900 dark:border-white bg-neutral-100 dark:bg-neutral-800 ring-1 ring-neutral-900 dark:ring-white" : "border-neutral-200 dark:border-neutral-800"
      }`}
    >
      <div className="flex shrink-0 items-center gap-2 px-3 py-2.5">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: stage.color ?? "#999" }} />
        <span className="min-w-0 truncate text-xs font-semibold tracking-wide text-neutral-600 dark:text-neutral-400 uppercase">
          {stage.name}
        </span>
        {sumValue > 0 && (
          <span className="shrink-0 text-[10px] font-medium tabular-nums text-neutral-400 dark:text-neutral-500">
            {formatCurrencyCompact(sumValue)}
          </span>
        )}
        <span className="ml-auto shrink-0 rounded-full bg-neutral-200/70 dark:bg-neutral-800/70 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-neutral-500 dark:text-neutral-400">
          {total}
        </span>
      </div>
      {healthPct !== null && (
        <div
          className="mx-3 mb-2 h-1 shrink-0 overflow-hidden rounded-full bg-neutral-200/70 dark:bg-neutral-800/70"
          title={`${withTaskCount} de ${total} com tarefa pendente · ${healthPct}%`}
        >
          <div className={`h-full rounded-full ${healthColor}`} style={{ width: `${healthPct}%` }} />
        </div>
      )}
      {/* overscroll-y-contain (não overscroll-contain nos dois eixos):
          quando o scroll vertical desta coluna chega no início/fim, impede
          que o "resto" do gesto passe pro ancestral (a página inteira) —
          sem isso, ao chegar no fim de uma coluna curta o scroll "vazava" e
          a página toda continuava rolando junto. Só no eixo Y de propósito:
          a coluna não rola horizontalmente sozinha (overflow-x-hidden), e o
          scroll horizontal de verdade é do container do Kanban (a linha
          inteira de colunas, ver abaixo). `overscroll-contain` nos dois
          eixos travava esse scroll horizontal sempre que o gesto começava
          em cima de uma coluna (só "vazava" pro container nos vãos entre
          colunas, onde não tinha essa div por cima) — daí o bug de scroll
          horizontal que só funcionava no vão entre etapas. */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="scrollbar-thin min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain px-2 pb-4"
      >
        {deals.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-neutral-400 dark:text-neutral-500">Nenhum negócio</p>
        )}
        <div style={{ position: "relative", height: deals.length * ROW_HEIGHT }}>
          {visibleDeals.map((deal, i) => (
            <div
              key={deal.id}
              style={{ position: "absolute", top: (startIndex + i) * ROW_HEIGHT, left: 0, right: 0, paddingBottom: CARD_GAP }}
            >
              <DealCard deal={deal} stageId={stage.id} />
            </div>
          ))}
        </div>
        {/* Sem botão de "carregar mais" — o próximo lote já é buscado
            sozinho ao chegar perto do fim (ver handleScroll acima). Isso aqui
            é só um indício visual de que tem mais vindo, não uma ação. */}
        {loadingMore && (
          <div className="flex w-full items-center justify-center py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-400 dark:text-neutral-500" />
          </div>
        )}
      </div>
    </div>
  );
});

// Ponto da faixa de tarefa — mesma régua atrasada→hoje→agendada→sem-tarefa
// de lib/task-urgency.ts, só a cor do indicador visual do card.
const URGENCY_DOT: Record<TaskUrgency, string> = {
  atrasada: "bg-red-500",
  hoje: "bg-amber-500",
  agendada: "bg-emerald-500",
  "sem-tarefa": "bg-neutral-300 dark:bg-neutral-700",
};

/** "Atrasada"/"Hoje" pro prazo mais próximo, ou dd/mm quando é uma data futura de verdade. */
function formatTaskDue(urgency: TaskUrgency, dueAt: Deal["nextTaskDueAt"]): string {
  if (urgency === "sem-tarefa" || !dueAt) return "";
  if (urgency === "atrasada") return "Atrasada";
  if (urgency === "hoje") return "Hoje";
  const d = typeof dueAt === "string" ? new Date(dueAt) : dueAt;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

// memo: sem isso, o rAF-throttle do scroll (acima) perde metade do valor —
// StageColumn ainda re-renderiza a cada frame rolado, e todo cartão visível
// re-renderizaria junto mesmo sem nenhuma prop sua ter mudado de verdade.
const DealCard = memo(function DealCard({ deal, stageId, overlay }: { deal: Deal; stageId?: string; overlay?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: deal.id,
    data: { stageId },
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  const hasTasks = deal.taskTypes.length > 0;
  const stale = isStale(deal.stageEnteredAt);
  const urgency = classifyTaskUrgency(deal.nextTaskDueAt);
  const dueLabel = formatTaskDue(urgency, deal.nextTaskDueAt);

  const content = (
    <div
      className={`relative rounded-lg border bg-white p-3 text-sm shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all duration-200 ease-smooth hover:-translate-y-0.5 hover:shadow-md dark:bg-neutral-900 ${
        stale
          ? "border-neutral-200 border-l-2 border-l-amber-500/70 dark:border-neutral-800 dark:border-l-amber-500/50"
          : "border-neutral-200 dark:border-neutral-800"
      } ${isDragging ? "opacity-40" : ""}`}
    >
      {deal.hasUnreadWhatsApp && (
        <span className="absolute -top-1.5 -right-1.5 flex h-3 w-3" title="O lead respondeu">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-red-600" />
        </span>
      )}
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate font-medium text-neutral-900 dark:text-neutral-100">{deal.name}</p>
        <Avatar
          name={deal.owner.name}
          src={deal.owner.photoUrl}
          size="xs"
          className="transition-shadow hover:ring-2 hover:ring-neutral-300 hover:ring-offset-2 hover:ring-offset-white dark:hover:ring-neutral-600 dark:hover:ring-offset-neutral-900"
        />
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs text-neutral-500 dark:text-neutral-400">{deal.contact.name}</p>
        {deal.creditType && (
          <Badge tone={CREDIT_TYPE_TONE[deal.creditType] ?? "neutral"} size="sm" className="shrink-0 whitespace-nowrap">
            {deal.creditType}
          </Badge>
        )}
      </div>
      {/* Faixa de tarefa — borda sólida + ponto colorido + "texto · prazo"
          quando tem tarefa pendente (cor pela urgência: atrasada/hoje/
          agendada, ver lib/task-urgency.ts); tracejada quando não tem
          nenhuma. Antes era um badge discreto ("Sem tarefa") ou uma fileira
          de ícones sem prazo nenhum visível — a informação mais acionável do
          card (tem prazo? venceu?) precisa ser a mais visível, não a menos. */}
      <div className="mt-1.5">
        {hasTasks ? (
          <div
            className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium ${
              urgency === "atrasada"
                ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-500/10 dark:text-red-300"
                : urgency === "hoje"
                  ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-500/10 dark:text-amber-300"
                  : "border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-800/50 dark:text-neutral-400"
            }`}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${URGENCY_DOT[urgency]}`} title={deal.taskTypes.join(", ")} />
            <span className="min-w-0 truncate">{deal.nextActivity}</span>
            {dueLabel && <span className="ml-auto shrink-0 tabular-nums">{dueLabel}</span>}
          </div>
        ) : (
          <div className="flex items-center gap-1.5 rounded-md border border-dashed border-red-400 px-2 py-1 text-[11px] font-medium text-red-500 dark:border-red-800/80 dark:text-red-400">
            <AlertTriangle className="h-3 w-3 shrink-0" strokeWidth={2} />
            Sem tarefa — agendar
          </div>
        )}
      </div>
      <div className="mt-2.5 flex items-center justify-between">
        <span className="text-xs font-medium tabular-nums text-neutral-700 dark:text-neutral-300">
          {formatCurrency(deal.value)}
        </span>
        <span
          className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${
            stale ? "text-amber-600 dark:text-amber-500" : "text-neutral-400 dark:text-neutral-500"
          }`}
        >
          {stale && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />}
          {daysSince(deal.stageEnteredAt)}d
        </span>
      </div>
    </div>
  );

  if (overlay) return content;

  return (
    // touch-manipulation (não touch-none): deixa o navegador rolar
    // normalmente ao arrastar o dedo — o TouchSensor com delay acima é quem
    // decide se virou um drag de verdade (dedo parado ~250ms) ou só um scroll.
    <div ref={setNodeRef} style={style} {...listeners} {...attributes} className="touch-manipulation">
      <Link href={`/negocios/${deal.id}`} onClick={(e) => isDragging && e.preventDefault()}>
        {content}
      </Link>
    </div>
  );
});
