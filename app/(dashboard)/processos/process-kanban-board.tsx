"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  CircleCheck,
  CircleDollarSign,
  Check,
  Trash2,
  Plus,
  Loader2,
} from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { Avatar } from "@/components/avatar";
import { FilterPopover } from "@/components/filter-popover";
import { Select } from "@/components/select";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DOCUMENT_STATUS_LABELS, DOCUMENT_STATUS_BADGE, type DocumentStatus } from "./document-status";

type Stage = { id: string; name: string; color: string | null; order: number };

const COLOR_PRESETS = ["#6366f1", "#8b5cf6", "#f59e0b", "#f97316", "#06b6d4", "#3b82f6", "#10b981", "#64748b", "#e34948"];

export type ProcessItem = {
  id: string;
  pipelineId: string;
  stageId: string;
  stage: { id: string; name: string; color: string | null };
  contemplated: boolean;
  paymentPending: boolean;
  documentStatus: DocumentStatus;
  quotaNumber: string | null;
  groupNumber: string | null;
  stageEnteredAt: string | Date;
  contact: { id: string; name: string; phone: string | null; whatsapp: string | null };
  owner: { id: string; name: string; photoUrl: string | null };
  deal: { id: string; name: string; value: number | null };
  openRequestCount: number;
  hasUnreadWhatsApp: boolean;
};

export function ProcessKanbanBoard({
  pipelineId,
  stages,
  processes,
  onProcessesChange,
  isAdmin,
}: {
  pipelineId: string;
  stages: Stage[];
  processes: ProcessItem[];
  onProcessesChange: (updater: (prev: ProcessItem[]) => ProcessItem[]) => void;
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
  const [contemplatedFilter, setContemplatedFilter] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("");
  const [documentFilter, setDocumentFilter] = useState("");

  const hasFilters = !!search || !!contemplatedFilter || !!paymentFilter || !!documentFilter;

  function clearFilters() {
    setSearch("");
    setContemplatedFilter("");
    setPaymentFilter("");
    setDocumentFilter("");
  }

  const filteredProcesses = useMemo(() => {
    const term = search.trim().toLowerCase();
    return processes.filter((p) => {
      if (term && !p.contact.name.toLowerCase().includes(term) && !p.deal.name.toLowerCase().includes(term)) return false;
      if (contemplatedFilter && String(p.contemplated) !== contemplatedFilter) return false;
      if (paymentFilter && String(p.paymentPending) !== paymentFilter) return false;
      if (documentFilter && p.documentStatus !== documentFilter) return false;
      return true;
    });
  }, [processes, search, contemplatedFilter, paymentFilter, documentFilter]);

  function handleDragStart(event: DragStartEvent) {
    if (!isAdmin) return;
    const process = processes.find((p) => p.id === event.active.id);
    setActiveProcess(process ?? null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveProcess(null);
    if (!isAdmin || !over) return;

    const processId = active.id as string;
    const targetStageId = over.id as string;
    const process = processes.find((p) => p.id === processId);
    if (!process || process.stageId === targetStageId) return;

    const previousStageId = process.stageId;
    const targetStage = stages.find((s) => s.id === targetStageId);
    setMoveError(null);
    onProcessesChange((prev) =>
      prev.map((p) =>
        p.id === processId && targetStage
          ? { ...p, stageId: targetStageId, stage: targetStage, stageEnteredAt: new Date() }
          : p,
      ),
    );
    setPending(true);

    const res = await fetch(`/api/processes/${processId}/move`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stageId: targetStageId }),
    });

    setPending(false);

    if (!res.ok) {
      onProcessesChange((prev) =>
        prev.map((p) => (p.id === processId ? { ...p, stageId: previousStageId } : p)),
      );
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
        </div>
        <FilterPopover active={hasFilters} onClear={clearFilters}>
          <div className="space-y-1">
            <label className="field-label">Contemplado</label>
            <Select
              value={contemplatedFilter}
              onChange={setContemplatedFilter}
              className="w-full py-1.5 text-sm"
              options={[
                { value: "", label: "Todos" },
                { value: "true", label: "Contemplados" },
                { value: "false", label: "Não contemplados" },
              ]}
            />
          </div>
          <div className="space-y-1">
            <label className="field-label">Pagamento</label>
            <Select
              value={paymentFilter}
              onChange={setPaymentFilter}
              className="w-full py-1.5 text-sm"
              options={[
                { value: "", label: "Todos" },
                { value: "true", label: "Falta pagar" },
                { value: "false", label: "Pagamento em dia" },
              ]}
            />
          </div>
          <div className="space-y-1">
            <label className="field-label">Documentação</label>
            <Select
              value={documentFilter}
              onChange={setDocumentFilter}
              className="w-full py-1.5 text-sm"
              options={[{ value: "", label: "Todos" }, ...Object.entries(DOCUMENT_STATUS_LABELS).map(([value, label]) => ({ value, label }))]}
            />
          </div>
        </FilterPopover>
      </div>

      {moveError && <p className="shrink-0 text-xs text-red-600 dark:text-red-400">{moveError}</p>}

      <DndContext id="process-kanban-board" sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="scrollbar-thin flex flex-1 gap-3 overflow-x-auto pb-4">
          {stages.map((stage) => (
            <StageColumn
              key={stage.id}
              pipelineId={pipelineId}
              stage={stage}
              processes={filteredProcesses.filter((p) => p.stageId === stage.id)}
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
  disabled,
  isAdmin,
}: {
  pipelineId: string;
  stage: Stage;
  processes: ProcessItem[];
  disabled: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const { setNodeRef, isOver } = useDroppable({ id: stage.id, disabled });
  const total = processes.reduce((sum, p) => sum + (p.deal.value ?? 0), 0);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(stage.name);
  const [showColors, setShowColors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showColors) return;
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setShowColors(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showColors]);

  async function patchStage(data: Partial<{ name: string; color: string }>) {
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

  async function deleteStage() {
    setConfirmingDelete(false);
    await fetch(`/api/process-pipelines/${pipelineId}/stages/${stage.id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col rounded-lg border bg-neutral-100/50 dark:bg-neutral-800/40 transition-colors ${
        isOver ? "border-neutral-900 dark:border-white bg-neutral-100 dark:bg-neutral-800 ring-1 ring-neutral-900 dark:ring-white" : "border-neutral-200 dark:border-neutral-800"
      }`}
    >
      {editing ? (
        <div className="m-1.5 flex items-center gap-1 rounded-md border border-blue-500 bg-white px-2 py-1.5 ring-1 ring-blue-500/30 dark:bg-neutral-900">
          <div className="relative shrink-0" ref={popoverRef}>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShowColors((v) => !v)}
              className="h-3.5 w-3.5 rounded-full ring-1 ring-black/10 transition-transform hover:scale-110 dark:ring-white/10"
              style={{ backgroundColor: stage.color ?? "#999" }}
              aria-label="Escolher cor"
            />
            {showColors && (
              <div className="surface-glass animate-pop-in absolute top-6 left-0 z-10 flex flex-wrap gap-1 rounded-md p-2 shadow-lg" style={{ width: 120 }}>
                {COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      patchStage({ color: c });
                      setShowColors(false);
                    }}
                    className="h-5 w-5 rounded-full ring-1 ring-black/10 transition-transform hover:scale-110 dark:ring-white/10"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            )}
          </div>
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
            disabled={processes.length > 0}
            className="icon-btn h-6 w-6 shrink-0 hover:text-red-600 dark:hover:text-red-400"
            title={processes.length > 0 ? "Mova os processos antes de excluir" : "Excluir etapa"}
            aria-label="Excluir etapa"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => isAdmin && setEditing(true)}
          className={`flex items-center gap-2 rounded-md px-3 py-2.5 text-left ${isAdmin ? "hover:bg-neutral-200/50 dark:hover:bg-neutral-800/60" : ""}`}
        >
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: stage.color ?? "#999" }} />
          <span className="text-xs font-semibold tracking-wide text-neutral-600 dark:text-neutral-400 uppercase">{stage.name}</span>
          {total > 0 && (
            <span className="truncate text-[10px] font-medium text-neutral-400 dark:text-neutral-500">{formatCurrency(total)}</span>
          )}
          <span className="ml-auto shrink-0 rounded-full bg-neutral-200/70 dark:bg-neutral-800/70 px-1.5 py-0.5 text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
            {processes.length}
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

      <div className="scrollbar-thin flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {processes.length === 0 && <p className="px-2 py-6 text-center text-xs text-neutral-400 dark:text-neutral-500">Nenhum processo</p>}
        {processes.map((process) => (
          <ProcessCard key={process.id} process={process} isAdmin={isAdmin} />
        ))}
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

function ProcessCard({
  process,
  isAdmin,
  overlay,
}: {
  process: ProcessItem;
  isAdmin: boolean;
  overlay?: boolean;
}) {
  const draggable = useDraggable({ id: process.id, disabled: !isAdmin });
  const { attributes, listeners, setNodeRef, transform, isDragging } = draggable;

  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;

  const content = (
    <div
      className={`relative rounded-lg border border-neutral-200 bg-white p-3 text-sm shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900 ${
        isDragging ? "opacity-40" : ""
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
        {process.contemplated && (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400">
            <CircleCheck className="h-3 w-3" strokeWidth={2} />
            Contemplado
          </span>
        )}
        {process.paymentPending && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-500/10 dark:text-amber-400">
            <CircleDollarSign className="h-3 w-3" strokeWidth={2} />
            Falta pagar
          </span>
        )}
        {process.documentStatus !== "DELIVERED" && (
          <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${DOCUMENT_STATUS_BADGE[process.documentStatus]}`}>
            <MessageSquareWarning className="h-3 w-3" strokeWidth={2} />
            {process.documentStatus === "NOT_REQUESTED" ? "Pedir doc." : "Doc. pendente"}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs font-medium tabular-nums text-neutral-700 dark:text-neutral-300">{formatCurrency(process.deal.value)}</span>
      </div>
    </div>
  );

  if (overlay) return content;

  return (
    <div ref={setNodeRef} style={style} {...(isAdmin ? { ...listeners, ...attributes } : {})} className="touch-manipulation">
      <Link href={`/processos/${process.id}`} onClick={(e) => isDragging && e.preventDefault()}>
        {content}
      </Link>
    </div>
  );
}
