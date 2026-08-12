"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
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
import {
  Search,
  MessageSquareWarning,
  MessageCircle,
  Check,
  Trash2,
  Plus,
  Loader2,
  Clock,
  StickyNote,
} from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/badge";
import { FilterPopover } from "@/components/filter-popover";
import { Select } from "@/components/select";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useFloatingDropdown } from "@/lib/use-floating-dropdown";
import { usePersistedFilters } from "@/lib/use-persisted-filters";
import { getStageSlaStatus } from "@/lib/processes/sla";
import { DOCUMENT_STATUS_LABELS, DOCUMENT_STATUS_TONE, type DocumentStatus } from "./document-status";

type Stage = { id: string; name: string; color: string | null; order: number; slaBusinessDays: number | null };

const COLOR_PRESETS = ["#6366f1", "#8b5cf6", "#f59e0b", "#f97316", "#06b6d4", "#3b82f6", "#10b981", "#64748b", "#e34948"];

export type ProcessItem = {
  id: string;
  pipelineId: string;
  stageId: string;
  stage: { id: string; name: string; color: string | null; slaBusinessDays: number | null };
  documentStatus: DocumentStatus;
  quotaNumber: string | null;
  groupNumber: string | null;
  stageEnteredAt: string | Date;
  contact: { id: string; name: string; phone: string | null; whatsapp: string | null };
  owner: { id: string; name: string; photoUrl: string | null };
  deal: { id: string; name: string; value: number | null };
  openRequestCount: number;
  hasUnreadWhatsApp: boolean;
  hasUnreadNote: boolean;
};

/**
 * Estado de busca/filtro dos processos — compartilhado entre o kanban
 * (desktop) e a lista agrupada por etapa (mobile), pra manter as duas visões
 * sempre filtrando exatamente do mesmo jeito.
 */
export function useProcessFilters(processes: ProcessItem[]) {
  const [search, setSearch] = useState("");
  const [documentFilter, setDocumentFilter] = useState("");

  const hasFilters = !!search || !!documentFilter;

  // Lembra o filtro usado da última vez nesta tela (F5, fechar a aba e
  // voltar, ou navegar pra outra tela e voltar) — ver lib/use-persisted-filters.ts.
  usePersistedFilters("processos", { search, documentFilter }, (saved) => {
    if (saved.search !== undefined) setSearch(saved.search);
    if (saved.documentFilter !== undefined) setDocumentFilter(saved.documentFilter);
  });

  function clearFilters() {
    setSearch("");
    setDocumentFilter("");
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return processes.filter((p) => {
      if (term && !p.contact.name.toLowerCase().includes(term) && !p.deal.name.toLowerCase().includes(term)) return false;
      if (documentFilter && p.documentStatus !== documentFilter) return false;
      return true;
    });
  }, [processes, search, documentFilter]);

  return {
    search,
    setSearch,
    documentFilter,
    setDocumentFilter,
    hasFilters,
    clearFilters,
    filtered,
  };
}

/** O select de filtro de documentação — mesmo conteúdo dentro do FilterPopover do kanban e da lista mobile. */
export function ProcessFilterFields({
  documentFilter,
  setDocumentFilter,
}: {
  documentFilter: string;
  setDocumentFilter: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="field-label">Documentação</label>
      <Select
        value={documentFilter}
        onChange={setDocumentFilter}
        className="w-full py-1.5 text-sm"
        options={[{ value: "", label: "Todos" }, ...Object.entries(DOCUMENT_STATUS_LABELS).map(([value, label]) => ({ value, label }))]}
      />
    </div>
  );
}

// Por coluna, não pro pipeline inteiro — mesma ideia de
// app/(dashboard)/pipeline/kanban-board.tsx: uma consulta só, com teto, na
// carga inicial/troca de filtro, agrupada por etapa; "carregar mais" busca só
// a etapa que precisa, quando o usuário rola até lá. Precisa bater com
// PROCESS_INITIAL_CAP em page.tsx.
const PROCESS_INITIAL_CAP = 400;
const PROCESS_STAGE_PAGE_SIZE = 60;
const SEARCH_DEBOUNCE_MS = 300;
const CARD_ROW_HEIGHT = 122;
const OVERSCAN = 6;
const LOAD_MORE_THRESHOLD_PX = CARD_ROW_HEIGHT * 3;
const EMPTY_PROCESSES: ProcessItem[] = [];

export function ProcessKanbanBoard({
  pipelineId,
  stages,
  initialProcessesByStage,
  initialCountByStage,
  isAdmin,
}: {
  pipelineId: string;
  stages: Stage[];
  initialProcessesByStage: Record<string, ProcessItem[]>;
  initialCountByStage: Record<string, number>;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [activeProcess, setActiveProcess] = useState<ProcessItem | null>(null);
  const [pending, setPending] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
  );

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [documentFilter, setDocumentFilter] = useState("");
  const hasFilters = !!search || !!documentFilter;

  const [processesByStage, setProcessesByStage] = useState<Record<string, ProcessItem[]>>(initialProcessesByStage);
  const [countByStage, setCountByStage] = useState<Record<string, number>>(initialCountByStage);
  const [stagesLoading, setStagesLoading] = useState(false);
  const [loadingMoreStages, setLoadingMoreStages] = useState<Set<string>>(new Set());

  // Ressincroniza quando o pipeline/subcategoria ativa muda — page.tsx já
  // busca de novo com o pipeline certo, isso só reflete no client. Também
  // pega a ressincronização depois de um router.refresh() (ex.: mover card).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProcessesByStage(initialProcessesByStage);
    setCountByStage(initialCountByStage);
  }, [initialProcessesByStage, initialCountByStage]);

  // Lembra o filtro usado da última vez nesta tela — mesma chave que
  // useProcessFilters (lista mobile) usa, os dois ficam em sincronia.
  usePersistedFilters("processos", { search, documentFilter }, (saved) => {
    if (saved.search !== undefined) setSearch(saved.search);
    if (saved.documentFilter !== undefined) setDocumentFilter(saved.documentFilter);
  });

  function clearFilters() {
    setSearch("");
    setDocumentFilter("");
  }

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // Refs pra handleLoadMore ter identidade estável (useCallback, deps vazias)
  // sem perder acesso aos filtros/contagem atuais — mesma razão de
  // kanban-board.tsx: recriar a função a cada tecla digitada derrubaria o
  // memo() de StageColumn.
  const filtersRef = useRef({ debouncedSearch, documentFilter });
  useEffect(() => {
    filtersRef.current = { debouncedSearch, documentFilter };
  }, [debouncedSearch, documentFilter]);

  const processesByStageRef = useRef(processesByStage);
  useEffect(() => {
    processesByStageRef.current = processesByStage;
  }, [processesByStage]);

  function buildFilterParams(filters: typeof filtersRef.current) {
    const params = new URLSearchParams();
    params.set("pipelineId", pipelineId);
    if (filters.debouncedSearch) params.set("q", filters.debouncedSearch);
    if (filters.documentFilter) params.set("documentStatus", filters.documentFilter);
    return params;
  }

  const skipNextFetch = useRef(true);

  useEffect(() => {
    if (skipNextFetch.current) {
      skipNextFetch.current = false;
      return;
    }
    let cancelled = false;
    setStagesLoading(true);
    const filters = { debouncedSearch, documentFilter };

    const dealsParams = buildFilterParams(filters);
    dealsParams.set("take", String(PROCESS_INITIAL_CAP));
    const countsParams = buildFilterParams(filters);

    Promise.all([
      fetch(`/api/processes?${dealsParams.toString()}`).then(async (res) =>
        res.ok ? ((await res.json()) as ProcessItem[]) : [],
      ),
      fetch(`/api/processes/stage-counts?${countsParams.toString()}`).then(async (res) =>
        res.ok ? ((await res.json()) as Record<string, number>) : {},
      ),
    ])
      .then(([items, counts]) => {
        if (cancelled) return;
        const byStage: Record<string, ProcessItem[]> = {};
        for (const p of items) (byStage[p.stageId] ??= []).push(p);
        setProcessesByStage(byStage);
        setCountByStage(counts);
      })
      .finally(() => {
        if (!cancelled) setStagesLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, documentFilter, pipelineId]);

  const handleLoadMore = useCallback(async (stageId: string) => {
    setLoadingMoreStages((prev) => new Set(prev).add(stageId));
    try {
      const params = buildFilterParams(filtersRef.current);
      params.set("stageId", stageId);
      const currentLength = processesByStageRef.current[stageId]?.length ?? 0;
      params.set("skip", String(currentLength));
      params.set("limit", String(PROCESS_STAGE_PAGE_SIZE));
      const res = await fetch(`/api/processes?${params.toString()}`);
      if (!res.ok) return;
      const more: ProcessItem[] = await res.json();
      const total = Number(res.headers.get("X-Total-Count") ?? currentLength + more.length);
      setProcessesByStage((prev) => ({ ...prev, [stageId]: [...(prev[stageId] ?? []), ...more] }));
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

  function handleDragStart(event: DragStartEvent) {
    if (!isAdmin) return;
    const stageId = (event.active.data.current as { stageId?: string } | undefined)?.stageId;
    const process = stageId ? processesByStage[stageId]?.find((p) => p.id === event.active.id) : undefined;
    setActiveProcess(process ?? null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveProcess(null);
    if (!isAdmin || !over) return;

    const processId = active.id as string;
    const targetStageId = over.id as string;
    const previousStageId = (active.data.current as { stageId?: string } | undefined)?.stageId;
    if (!previousStageId) return;
    const process = processesByStage[previousStageId]?.find((p) => p.id === processId);
    const targetStage = stages.find((s) => s.id === targetStageId);
    if (!process || !targetStage || previousStageId === targetStageId) return;

    setMoveError(null);
    setProcessesByStage((prev) => ({
      ...prev,
      [previousStageId]: (prev[previousStageId] ?? []).filter((p) => p.id !== processId),
      [targetStageId]: [
        { ...process, stageId: targetStageId, stage: targetStage, stageEnteredAt: new Date() },
        ...(prev[targetStageId] ?? []),
      ],
    }));
    setCountByStage((prev) => ({
      ...prev,
      [previousStageId]: Math.max(0, (prev[previousStageId] ?? 1) - 1),
      [targetStageId]: (prev[targetStageId] ?? 0) + 1,
    }));
    setPending(true);

    const res = await fetch(`/api/processes/${processId}/move`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stageId: targetStageId }),
    });

    setPending(false);

    if (!res.ok) {
      setProcessesByStage((prev) => ({
        ...prev,
        [targetStageId]: (prev[targetStageId] ?? []).filter((p) => p.id !== processId),
        [previousStageId]: [{ ...process, stageId: previousStageId }, ...(prev[previousStageId] ?? [])],
      }));
      setCountByStage((prev) => ({
        ...prev,
        [targetStageId]: Math.max(0, (prev[targetStageId] ?? 1) - 1),
        [previousStageId]: (prev[previousStageId] ?? 0) + 1,
      }));
      const data = await res.json().catch(() => ({}));
      setMoveError(data.error ?? "Não foi possível mover o processo");
      return;
    }

    // Ressincroniza com o servidor depois de mover — o estado local otimista
    // já mostrou o card na coluna nova, mas só atualizar esse array em
    // memória (sem refresh nenhum) deixa a página vulnerável a ficar
    // dessincronizada do banco se qualquer coisa external mudar os dados
    // nesse meio-tempo (ex.: outro admin movendo o mesmo card). Mesmo padrão
    // que a página de detalhe já usa depois de qualquer mutação.
    router.refresh();
  }

  // Mede a distância real até o fim da janela e trava a altura da fileira
  // nesse valor — mesmo motivo/mesmo padrão de kanban-board.tsx: não dá pra
  // confiar só em h-full/flex-1 se propagando certo por vários containers, e
  // sem isso as colunas cresciam pra caber o conteúdo em vez de rolar sozinhas.
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
            placeholder="Buscar cliente ou negócio"
            className="field-input w-56 py-1.5 pl-8 text-sm"
          />
          {stagesLoading && (
            <Loader2 className="absolute top-1/2 right-2.5 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-neutral-400 dark:text-neutral-500" />
          )}
        </div>
        <FilterPopover active={hasFilters} onClear={clearFilters}>
          <ProcessFilterFields documentFilter={documentFilter} setDocumentFilter={setDocumentFilter} />
        </FilterPopover>
      </div>

      {moveError && <p className="shrink-0 text-xs text-red-600 dark:text-red-400">{moveError}</p>}

      <DndContext id="process-kanban-board" sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div
          ref={rowRef}
          style={rowHeight != null ? { height: rowHeight, flex: "0 0 auto" } : undefined}
          className="scrollbar-thin flex min-h-0 flex-1 gap-3 overflow-x-auto pb-4"
        >
          {stages.map((stage) => (
            <StageColumn
              key={stage.id}
              pipelineId={pipelineId}
              stage={stage}
              processes={processesByStage[stage.id] ?? EMPTY_PROCESSES}
              total={countByStage[stage.id] ?? processesByStage[stage.id]?.length ?? 0}
              loadingMore={loadingMoreStages.has(stage.id)}
              onLoadMore={handleLoadMore}
              disabled={pending || !isAdmin}
              isAdmin={isAdmin}
            />
          ))}
          {isAdmin && <AddStageColumn pipelineId={pipelineId} nextColor={COLOR_PRESETS[stages.length % COLOR_PRESETS.length]} />}
        </div>
        <DragOverlay>{activeProcess ? <ProcessCard process={activeProcess} isAdmin={isAdmin} overlay /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}

function StageColumn({
  pipelineId,
  stage,
  processes,
  total,
  loadingMore,
  onLoadMore,
  disabled,
  isAdmin,
}: {
  pipelineId: string;
  stage: Stage;
  /** Só o que já foi carregado nesta coluna — ver total abaixo pro número de verdade. */
  processes: ProcessItem[];
  /** Total real (banco) desta etapa, sob os filtros atuais. */
  total: number;
  loadingMore: boolean;
  onLoadMore: (stageId: string) => void;
  disabled: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const { setNodeRef, isOver } = useDroppable({ id: stage.id, disabled });
  const totalValue = processes.reduce((sum, p) => sum + (p.deal.value ?? 0), 0);
  const hasMore = processes.length < total;

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(stage.name);
  const [sla, setSla] = useState(stage.slaBusinessDays != null ? String(stage.slaBusinessDays) : "");
  const [showColors, setShowColors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const colorTriggerRef = useRef<HTMLButtonElement>(null);
  const colorPanelRef = useRef<HTMLDivElement>(null);

  // Portal + position:fixed (mesmo padrão de components/select.tsx) — sem
  // isso, o popover de cor (position:absolute normal) fica cortado assim que
  // a coluna não está na primeira posição visível do carrossel horizontal do
  // kanban (overflow-x-auto corta overflow-y também, por spec do CSS).
  const colorCoords = useFloatingDropdown({
    open: showColors,
    onClose: () => setShowColors(false),
    triggerRef: colorTriggerRef,
    panelRef: colorPanelRef,
  });

  async function patchStage(data: Partial<{ name: string; color: string; slaBusinessDays: number | null }>) {
    setSaving(true);
    await fetch(`/api/process-pipelines/${pipelineId}/stages/${stage.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setSaving(false);
    router.refresh();
  }

  function commitName() {
    const trimmed = name.trim();
    if (trimmed && trimmed !== stage.name) patchStage({ name: trimmed });
    else setName(stage.name);
    setEditing(false);
  }

  function commitSla() {
    const trimmed = sla.trim();
    const parsed = trimmed ? Math.max(1, Math.round(Number(trimmed))) : null;
    if (Number.isNaN(parsed as number)) {
      setSla(stage.slaBusinessDays != null ? String(stage.slaBusinessDays) : "");
      return;
    }
    if (parsed !== stage.slaBusinessDays) patchStage({ slaBusinessDays: parsed });
  }

  async function deleteStage() {
    setConfirmingDelete(false);
    await fetch(`/api/process-pipelines/${pipelineId}/stages/${stage.id}`, { method: "DELETE" });
    router.refresh();
  }

  // Virtualização — mesmo padrão de app/(dashboard)/pipeline/kanban-board.tsx:
  // só monta no DOM os cartões perto da área visível. Sem isso, uma etapa com
  // muitos processos montava todos de uma vez.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(640);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewportHeight(el.clientHeight);
    const observer = new ResizeObserver(() => setViewportHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const scrollRaf = useRef<number | null>(null);
  const loadMoreRequestedRef = useRef(false);
  useEffect(() => {
    loadMoreRequestedRef.current = false;
  }, [processes.length]);

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

  const rawStartIndex = Math.max(0, Math.floor(scrollTop / CARD_ROW_HEIGHT) - OVERSCAN);
  const rawEndIndex = Math.min(processes.length, Math.ceil((scrollTop + viewportHeight) / CARD_ROW_HEIGHT) + OVERSCAN);
  const visibleProcesses = processes.slice(rawStartIndex, rawEndIndex);

  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col rounded-lg border bg-neutral-100/50 dark:bg-neutral-800/40 transition-colors ${
        isOver ? "border-neutral-900 dark:border-white bg-neutral-100 dark:bg-neutral-800 ring-1 ring-neutral-900 dark:ring-white" : "border-neutral-200 dark:border-neutral-800"
      }`}
    >
      {editing ? (
        <div className="m-1.5 flex flex-col gap-1.5 rounded-md border border-blue-500 bg-white px-2 py-1.5 ring-1 ring-blue-500/30 dark:bg-neutral-900">
        <div className="flex items-center gap-1">
          <button
            ref={colorTriggerRef}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setShowColors((v) => !v)}
            className="h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-black/10 transition-transform hover:scale-110 dark:ring-white/10 coarse:h-9 coarse:w-9"
            style={{ backgroundColor: stage.color ?? "#999" }}
            aria-label="Escolher cor"
          />
          {showColors &&
            colorCoords &&
            typeof document !== "undefined" &&
            createPortal(
              <div
                ref={colorPanelRef}
                className="surface-glass animate-pop-in fixed z-50 flex w-[120px] flex-wrap gap-1 rounded-md p-2 shadow-lg coarse:w-[156px]"
                style={{ top: colorCoords.top, left: colorCoords.left }}
              >
                {COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      patchStage({ color: c });
                      setShowColors(false);
                    }}
                    className="h-5 w-5 rounded-full ring-1 ring-black/10 transition-transform hover:scale-110 dark:ring-white/10 coarse:h-8 coarse:w-8"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>,
              document.body,
            )}
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") {
                setName(stage.name);
                setEditing(false);
              }
            }}
            onFocus={(e) => e.target.select()}
            onBlur={commitName}
            className="min-w-0 flex-1 bg-transparent text-xs font-semibold text-neutral-900 outline-none dark:text-neutral-100"
          />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={commitName}
            disabled={saving}
            className="icon-btn h-6 w-6 shrink-0 text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
            aria-label="Salvar"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} /> : <Check className="h-3.5 w-3.5" strokeWidth={2.5} />}
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setConfirmingDelete(true)}
            disabled={total > 0}
            className="icon-btn h-6 w-6 shrink-0 hover:text-red-600 dark:hover:text-red-400"
            title={total > 0 ? "Mova os processos antes de excluir" : "Excluir etapa"}
            aria-label="Excluir etapa"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
        <div className="flex items-center gap-1 pl-4.5">
          <Clock className="h-3 w-3 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
          <input
            type="number"
            min={1}
            value={sla}
            onChange={(e) => setSla(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitSla();
              if (e.key === "Escape") setSla(stage.slaBusinessDays != null ? String(stage.slaBusinessDays) : "");
            }}
            onBlur={commitSla}
            placeholder="Prazo (dias úteis)"
            className="min-w-0 flex-1 bg-transparent text-[11px] text-neutral-600 outline-none dark:text-neutral-300"
          />
        </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => isAdmin && setEditing(true)}
          className={`flex items-center gap-2 rounded-md px-3 py-2.5 text-left ${isAdmin ? "hover:bg-neutral-200/50 dark:hover:bg-neutral-800/60" : ""}`}
        >
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: stage.color ?? "#999" }} />
          <span className="min-w-0 truncate text-xs font-semibold tracking-wide text-neutral-600 dark:text-neutral-400 uppercase">
            {stage.name}
          </span>
          {stage.slaBusinessDays != null && (
            <span
              title={`Prazo desta etapa: ${stage.slaBusinessDays} dias úteis`}
              className="shrink-0 text-neutral-300 dark:text-neutral-600"
            >
              <Clock className="h-3 w-3" strokeWidth={2} />
            </span>
          )}
          {totalValue > 0 && (
            <span className="shrink-0 text-[10px] font-medium tabular-nums text-neutral-400 dark:text-neutral-500">{formatCurrency(totalValue)}</span>
          )}
          <span className="ml-auto shrink-0 rounded-full bg-neutral-200/70 dark:bg-neutral-800/70 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-neutral-500 dark:text-neutral-400">
            {total}
          </span>
        </button>
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title={`Excluir a etapa "${stage.name}"?`}
          description="Essa ação não pode ser desfeita."
          confirmLabel="Excluir"
          onClose={() => setConfirmingDelete(false)}
          onConfirm={deleteStage}
        />
      )}

      {/* overscroll-y-contain, não overscroll-contain nos dois eixos — ver
          comentário equivalente em pipeline/kanban-board.tsx: nos dois eixos
          isso bloqueava o scroll horizontal da linha de colunas sempre que o
          gesto começava em cima de uma coluna (só funcionava no vão entre
          etapas, onde essa div não cobre o container de fora). */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="scrollbar-thin min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain px-2 pb-4"
      >
        {processes.length === 0 && <p className="px-2 py-6 text-center text-xs text-neutral-400 dark:text-neutral-500">Nenhum processo</p>}
        <div style={{ position: "relative", height: processes.length * CARD_ROW_HEIGHT }}>
          {visibleProcesses.map((process, i) => (
            <div
              key={process.id}
              style={{ position: "absolute", top: (rawStartIndex + i) * CARD_ROW_HEIGHT, left: 0, right: 0, paddingBottom: 8 }}
            >
              <ProcessCard process={process} isAdmin={isAdmin} stageId={stage.id} />
            </div>
          ))}
        </div>
        {loadingMore && (
          <div className="flex w-full items-center justify-center py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-400 dark:text-neutral-500" />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Coluna fantasma no fim do board — clica, digita o nome ali mesmo e
 * confirma; sem precisar ir em Configurações → Processos pra criar uma
 * etapa nova. Cor já vem pré-escolhida (próximo tom do preset, mesmo
 * rodízio que app/(dashboard)/configuracoes/processos/process-stage-manager.tsx usa).
 */
function AddStageColumn({ pipelineId, nextColor }: { pipelineId: string; nextColor: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) {
      setEditing(false);
      return;
    }
    setCreating(true);
    setError(null);
    const res = await fetch(`/api/process-pipelines/${pipelineId}/stages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed, color: nextColor }),
    });
    setCreating(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao criar etapa");
      return;
    }
    setName("");
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="flex h-10 w-72 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-dashed border-neutral-300 text-xs font-medium text-neutral-400 transition-colors hover:border-neutral-400 hover:text-neutral-600 dark:border-neutral-700 dark:text-neutral-500 dark:hover:border-neutral-600 dark:hover:text-neutral-300"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
        Adicionar etapa
      </button>
    );
  }

  return (
    <div className="flex w-72 shrink-0 flex-col gap-1">
      <div className="flex items-center gap-1 rounded-md border border-blue-500 bg-white px-2 py-1.5 ring-1 ring-blue-500/30 dark:bg-neutral-900">
        <span className="h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/10" style={{ backgroundColor: nextColor }} />
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome da etapa"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreate();
            if (e.key === "Escape") {
              setName("");
              setEditing(false);
            }
          }}
          onBlur={handleCreate}
          className="min-w-0 flex-1 bg-transparent text-xs font-semibold text-neutral-900 outline-none dark:text-neutral-100"
        />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleCreate}
          disabled={creating}
          className="icon-btn h-6 w-6 shrink-0 text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
          aria-label="Criar etapa"
        >
          {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} /> : <Check className="h-3.5 w-3.5" strokeWidth={2.5} />}
        </button>
      </div>
      {error && <p className="px-1 text-[11px] text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

/** Conteúdo visual do card — compartilhado entre o kanban (arrastável) e a
 * lista mobile (sem drag, só toque-pra-abrir), pra não duplicar o mesmo
 * markup em dois lugares. */
export function ProcessCardContent({ process, dimmed }: { process: ProcessItem; dimmed?: boolean }) {
  // null quando a etapa não tem prazo configurado; badge só aparece se
  // atrasado de verdade (mesmo padrão dos outros badges deste card — só
  // sinaliza o que precisa de atenção, não o estado rotineiro).
  const sla = getStageSlaStatus(process.stage, new Date(process.stageEnteredAt));
  return (
    <div
      className={`relative rounded-lg border border-neutral-200 bg-white p-3 text-sm shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all duration-200 ease-smooth hover:-translate-y-0.5 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900 ${
        dimmed ? "opacity-40" : ""
      }`}
    >
      {process.openRequestCount > 0 && (
        <span
          className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white"
          title={`${process.openRequestCount} solicitação(ões) pendente(s)`}
        >
          {process.openRequestCount}
        </span>
      )}
      <div className="flex items-start justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 truncate font-medium text-neutral-900 dark:text-neutral-100">
          {process.hasUnreadWhatsApp && (
            <span title="Mensagem de WhatsApp não lida" className="shrink-0">
              <MessageCircle className="h-3.5 w-3.5 fill-emerald-500 text-emerald-500" strokeWidth={2} />
            </span>
          )}
          {process.hasUnreadNote && (
            <span title="Anotação nova do administrativo" className="shrink-0">
              <StickyNote className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" strokeWidth={2} />
            </span>
          )}
          <span className="truncate">{process.contact.name}</span>
        </p>
        <Avatar name={process.owner.name} src={process.owner.photoUrl} size="xs" />
      </div>
      <p className="mt-1 truncate text-xs text-neutral-500 dark:text-neutral-400">{process.deal.name}</p>
      {(process.quotaNumber || process.groupNumber) && (
        <p className="mt-0.5 truncate text-[11px] text-neutral-400 dark:text-neutral-500">
          {process.quotaNumber && `Cota ${process.quotaNumber}`}
          {process.quotaNumber && process.groupNumber && " · "}
          {process.groupNumber && `Grupo ${process.groupNumber}`}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {process.documentStatus !== "DELIVERED" && (
          <Badge tone={DOCUMENT_STATUS_TONE[process.documentStatus]} size="sm">
            <MessageSquareWarning className="h-3 w-3" strokeWidth={2} />
            {process.documentStatus === "NOT_REQUESTED" ? "Pedir doc." : "Doc. pendente"}
          </Badge>
        )}
        {sla?.overdue && (
          <Badge tone="danger" size="sm">
            <Clock className="h-3 w-3" strokeWidth={2} />
            {sla.daysOverdue}d em atraso
          </Badge>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs font-medium tabular-nums text-neutral-700 dark:text-neutral-300">{formatCurrency(process.deal.value)}</span>
      </div>
    </div>
  );
}

function ProcessCard({
  process,
  isAdmin,
  stageId,
  overlay,
}: {
  process: ProcessItem;
  isAdmin: boolean;
  stageId?: string;
  overlay?: boolean;
}) {
  const draggable = useDraggable({ id: process.id, disabled: !isAdmin, data: { stageId } });
  const { attributes, listeners, setNodeRef, transform, isDragging } = draggable;

  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;

  if (overlay) return <ProcessCardContent process={process} dimmed={isDragging} />;

  return (
    <div ref={setNodeRef} style={style} {...(isAdmin ? { ...listeners, ...attributes } : {})} className="touch-manipulation">
      <Link href={`/processos/${process.id}`} onClick={(e) => isDragging && e.preventDefault()}>
        <ProcessCardContent process={process} dimmed={isDragging} />
      </Link>
    </div>
  );
}
