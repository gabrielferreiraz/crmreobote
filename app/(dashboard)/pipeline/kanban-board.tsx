"use client";

import { memo, useCallback, useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { Search, AlertTriangle } from "lucide-react";
import { formatCurrency, daysSince } from "@/lib/format";
import { isStale } from "@/lib/stale";
import { Avatar } from "@/components/avatar";
import { FilterPopover } from "@/components/filter-popover";
import { Select } from "@/components/select";
import { TASK_TYPE_ICON, TASK_TYPE_LABELS } from "@/lib/task-icons";
import { usePersistedFilters } from "@/lib/use-persisted-filters";
import { sortSelfFirst } from "@/lib/sort-self-first";

type Stage = { id: string; name: string; color: string | null; order: number };

const CREDIT_TYPE_BADGE: Record<string, string> = {
  "IMÓVEL":
    "border-emerald-200/60 bg-emerald-50/60 text-emerald-700/80 dark:border-emerald-800/40 dark:bg-emerald-500/5 dark:text-emerald-400/70",
  "VEÍCULO":
    "border-slate-200/60 bg-slate-50/60 text-slate-600/80 dark:border-slate-700/40 dark:bg-slate-500/5 dark:text-slate-400/70",
};
const CREDIT_TYPE_BADGE_DEFAULT =
  "border-neutral-200 bg-neutral-50 text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-400";

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
  hasUnreadWhatsApp: boolean;
  lossReasonId: string | null;
  lossReason: { id: string; label: string } | null;
  // Texto livre — é o que a migração do Agendor preenche (não existia
  // motivo estruturado lá). Sempre cair pra ele quando não houver
  // lossReasonId, senão negócio perdido migrado aparece sem motivo nenhum.
  lostReason: string | null;
};

type MemberOption = { id: string; name: string };

// Referência estável pra etapas sem nenhum negócio — evitar criar um array
// novo a cada render aqui deixa o memo() do StageColumn (ver abaixo) de fato
// pular o re-render dessas colunas quando nada relevante pra elas mudou.
const EMPTY_DEALS: Deal[] = [];

export function KanbanBoard({
  stages,
  deals,
  onDealsChange,
  members,
  currentUserId,
}: {
  stages: Stage[];
  deals: Deal[];
  onDealsChange: (updater: (prev: Deal[]) => Deal[]) => void;
  members: MemberOption[];
  currentUserId?: string;
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
  const [ownerFilter, setOwnerFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [jobTitleFilter, setJobTitleFilter] = useState("");
  const [staleOnly, setStaleOnly] = useState(false);

  const openDeals = useMemo(() => deals.filter((d) => d.status === "OPEN"), [deals]);

  // "Eu" sempre em primeiro no filtro de Responsável — acha a si mesmo na
  // hora, sem procurar o próprio nome no meio da lista de consultores.
  const orderedMembers = useMemo(() => sortSelfFirst(members, currentUserId), [members, currentUserId]);

  const sourceOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of openDeals) if (d.contact.source) set.add(d.contact.source);
    return Array.from(set).sort();
  }, [openDeals]);

  const jobTitleOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of openDeals) if (d.contact.jobTitle) set.add(d.contact.jobTitle);
    return Array.from(set).sort();
  }, [openDeals]);

  const hasFilters = !!search || !!ownerFilter || !!sourceFilter || !!jobTitleFilter || staleOnly;

  // Lembra o filtro usado da última vez nesta tela (F5, fechar a aba e
  // voltar, ou navegar pra outra tela e voltar) — ver lib/use-persisted-filters.ts.
  usePersistedFilters("pipeline-kanban", { search, ownerFilter, sourceFilter, jobTitleFilter, staleOnly }, (saved) => {
    if (saved.search !== undefined) setSearch(saved.search);
    if (saved.ownerFilter !== undefined) setOwnerFilter(saved.ownerFilter);
    if (saved.sourceFilter !== undefined) setSourceFilter(saved.sourceFilter);
    if (saved.jobTitleFilter !== undefined) setJobTitleFilter(saved.jobTitleFilter);
    if (saved.staleOnly !== undefined) setStaleOnly(saved.staleOnly);
  });

  function clearFilters() {
    setSearch("");
    setOwnerFilter("");
    setSourceFilter("");
    setJobTitleFilter("");
    setStaleOnly(false);
  }

  // Adia o valor usado no filtro pesado (não o do input, que continua
  // ecoando cada tecla na hora) — com milhares de negócios OPEN, o React
  // prioriza manter a digitação instantânea e só recalcula filteredDeals
  // (e por tabela o board inteiro) assim que sobrar folga, em vez de travar
  // o campo de busca esperando o re-render de todas as colunas.
  const deferredSearch = useDeferredValue(search);
  const deferredOwnerFilter = useDeferredValue(ownerFilter);
  const deferredSourceFilter = useDeferredValue(sourceFilter);
  const deferredJobTitleFilter = useDeferredValue(jobTitleFilter);
  const deferredStaleOnly = useDeferredValue(staleOnly);

  const filteredDeals = useMemo(() => {
    const term = deferredSearch.trim().toLowerCase();
    return openDeals.filter((d) => {
      if (term && !d.name.toLowerCase().includes(term) && !d.contact.name.toLowerCase().includes(term)) {
        return false;
      }
      if (deferredOwnerFilter && d.owner.id !== deferredOwnerFilter) return false;
      if (deferredSourceFilter && d.contact.source !== deferredSourceFilter) return false;
      if (deferredJobTitleFilter && d.contact.jobTitle !== deferredJobTitleFilter) return false;
      if (deferredStaleOnly && !isStale(d.stageEnteredAt)) return false;
      return true;
    });
  }, [openDeals, deferredSearch, deferredOwnerFilter, deferredSourceFilter, deferredJobTitleFilter, deferredStaleOnly]);

  // Agrupa por etapa numa única passada (O(negócios)) em vez de um .filter()
  // por coluna (O(etapas × negócios)) — com várias etapas e milhares de
  // negócios, filtrar o array inteiro uma vez por coluna a cada render era
  // trabalho redundante que só cresce com o funil.
  const dealsByStage = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const d of filteredDeals) {
      const arr = map.get(d.stageId);
      if (arr) arr.push(d);
      else map.set(d.stageId, [d]);
    }
    return map;
  }, [filteredDeals]);

  function handleDragStart(event: DragStartEvent) {
    const deal = openDeals.find((d) => d.id === event.active.id);
    setActiveDeal(deal ?? null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveDeal(null);
    if (!over) return;

    const dealId = active.id as string;
    const targetStageId = over.id as string;
    const deal = openDeals.find((d) => d.id === dealId);
    if (!deal || deal.stageId === targetStageId) return;

    const previousStageId = deal.stageId;
    setMoveError(null);
    onDealsChange((prev) =>
      prev.map((d) =>
        d.id === dealId ? { ...d, stageId: targetStageId, stageEnteredAt: new Date() } : d,
      ),
    );
    setPending(true);

    const res = await fetch(`/api/deals/${dealId}/move`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stageId: targetStageId }),
    });

    setPending(false);

    if (!res.ok) {
      onDealsChange((prev) =>
        prev.map((d) => (d.id === dealId ? { ...d, stageId: previousStageId } : d)),
      );
      const data = await res.json().catch(() => ({}));
      setMoveError(data.error ?? "Não foi possível mover o negócio");
    }
  }

  return (
    <div className="flex h-full flex-col gap-3">
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
          <button
            onClick={() => setStaleOnly((v) => !v)}
            className={`inline-flex w-full items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
              staleOnly
                ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300"
                : "border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />
            Só parados
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
        <div className="scrollbar-thin flex flex-1 gap-4 overflow-x-auto pb-4">
          {stages.map((stage) => (
            <StageColumn
              key={stage.id}
              stage={stage}
              deals={dealsByStage.get(stage.id) ?? EMPTY_DEALS}
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
// crédito, tarefas, valor+dias), então a altura real varia muito pouco e uma
// estimativa fixa é suficiente pra virtualizar sem precisar medir cada um.
const CARD_GAP = 22;
const ROW_HEIGHT = 108 + CARD_GAP;
// Linhas extras montadas acima/abaixo da área visível — sem essa margem, um
// scroll rápido mostraria um instante de coluna vazia antes do próximo lote
// de cartões terminar de montar.
const OVERSCAN = 6;

// memo: cada arrasto muda `activeDeal`/`pending` no componente pai — sem
// isso, TODAS as colunas re-renderizavam a cada movimento do mouse durante o
// drag, mesmo as que não têm nenhum negócio envolvido (o `deals` de cada
// coluna vem de dealsByStage, que só muda identidade quando filteredDeals
// muda de verdade, ver acima).
const StageColumn = memo(function StageColumn({
  stage,
  deals,
  disabled,
  activeDealId,
}: {
  stage: Stage;
  deals: Deal[];
  disabled: boolean;
  activeDealId: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id, disabled });
  const total = deals.reduce((sum, d) => sum + (d.value ?? 0), 0);

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
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop;
    if (scrollRaf.current != null) cancelAnimationFrame(scrollRaf.current);
    scrollRaf.current = requestAnimationFrame(() => setScrollTop(top));
  }, []);
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
      className={`flex w-64 shrink-0 flex-col rounded-lg border bg-neutral-100/50 dark:bg-neutral-800/40 transition-colors ${
        isOver ? "border-neutral-900 dark:border-white bg-neutral-100 dark:bg-neutral-800 ring-1 ring-neutral-900 dark:ring-white" : "border-neutral-200 dark:border-neutral-800"
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: stage.color ?? "#999" }} />
        <span className="min-w-0 truncate text-xs font-semibold tracking-wide text-neutral-600 dark:text-neutral-400 uppercase">
          {stage.name}
        </span>
        {total > 0 && (
          <span className="shrink-0 text-[10px] font-medium text-neutral-400 dark:text-neutral-500">
            {formatCurrency(total)}
          </span>
        )}
        <span className="ml-auto shrink-0 rounded-full bg-neutral-200/70 dark:bg-neutral-800/70 px-1.5 py-0.5 text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
          {deals.length}
        </span>
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="scrollbar-thin flex-1 overflow-x-hidden overflow-y-auto px-2 pb-4"
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
              <DealCard deal={deal} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

// memo: sem isso, o rAF-throttle do scroll (acima) perde metade do valor —
// StageColumn ainda re-renderiza a cada frame rolado, e todo cartão visível
// re-renderizaria junto mesmo sem nenhuma prop sua ter mudado de verdade.
const DealCard = memo(function DealCard({ deal, overlay }: { deal: Deal; overlay?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: deal.id,
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  const hasTasks = deal.taskTypes.length > 0;
  const stale = isStale(deal.stageEnteredAt);

  const content = (
    <div
      className={`relative rounded-lg border bg-white p-3 text-sm shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all hover:-translate-y-0.5 hover:shadow-md dark:bg-neutral-900 ${
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
          <span
            className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap ${
              CREDIT_TYPE_BADGE[deal.creditType] ?? CREDIT_TYPE_BADGE_DEFAULT
            }`}
          >
            {deal.creditType}
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        {hasTasks ? (
          deal.taskTypes.map((type) => {
            const Icon = TASK_TYPE_ICON[type] ?? TASK_TYPE_ICON.OTHER;
            return (
              <span key={type} title={TASK_TYPE_LABELS[type] ?? type}>
                <Icon className="h-3.5 w-3.5 text-neutral-600 dark:text-neutral-400" strokeWidth={2} />
              </span>
            );
          })
        ) : (
          <span
            className="inline-flex items-center gap-1 rounded bg-red-100/70 dark:bg-red-950/30 px-1.5 py-0.5 text-[10px] font-bold text-red-600 dark:text-red-400 border border-red-200/50 dark:border-red-900/30 uppercase tracking-wide animate-pulse"
            title="Sem tarefa agendada! Crie uma tarefa."
          >
            <AlertTriangle className="h-3 w-3 text-red-600 dark:text-red-400" strokeWidth={2.5} />
            Sem tarefa!
          </span>
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
