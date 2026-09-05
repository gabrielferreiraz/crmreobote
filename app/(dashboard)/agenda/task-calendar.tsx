"use client";

import { useEffect, useMemo, useState } from "react";
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
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, CheckSquare, Square, Layers, X } from "lucide-react";
import { Modal } from "@/components/modal";
import { Avatar } from "@/components/avatar";
import { SelectionBar } from "@/components/selection-bar";
import { TASK_TYPE_ICON, TASK_TYPE_COLOR } from "@/lib/task-icons";
import { TaskRow, type Task } from "./task-row";
import { TaskDetailModal } from "./task-detail-modal";
import { GoogleEventDetailModal } from "./google-event-detail-modal";
import { useMeetingOutcomeGate } from "./use-meeting-outcome-gate";
import type { Option } from "./tasks-list";

export type GoogleEvent = {
  id: string;
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  htmlLink: string;
  description: string | null;
  location: string | null;
};

const WEEKDAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const MONTH_LABELS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** "2026-09-03" no calendário LOCAL do navegador (não força fuso — mesma
 * convenção do resto deste arquivo, que já lê data/hora nativa do Date em
 * vez de forçar Brasil; server-side isso importaria, ver lib/timezone.ts,
 * mas aqui quem roda é o navegador de quem está usando o CRM). Usado só
 * pra mandar o dia de destino do arraste-e-soltar pro backend
 * (POST /api/tasks/bulk-move) — nunca pra exibir nada. */
function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function TaskCalendar({
  tasks,
  onToggle,
  onDelete,
  onBulkMove,
  canDelete,
  showOwner,
  googleEvents = [],
  deals,
}: {
  tasks: Task[];
  onToggle: (id: string, completed: boolean, meetingOutcome?: "ATTENDED" | "NO_SHOW" | "RESCHEDULED", newDueAt?: string) => void;
  onDelete?: (id: string) => Promise<void> | void;
  /** Arrastar-e-soltar pra outro dia (uma ou várias tarefas selecionadas de
   * uma vez) — ver POST /api/tasks/bulk-move. Opcional: sem isso, a grade
   * continua funcionando igual antes, só sem os cartões virarem
   * arrastáveis (nenhum chamador hoje deixa de passar, mas assim nenhum
   * outro uso futuro deste componente quebra por causa disso). */
  onBulkMove?: (taskIds: string[], newDate: string) => Promise<{ ok: boolean; error?: string }>;
  /** Qualquer papel com acesso à tarefa pode excluir — ver TaskDetailModal. */
  canDelete?: boolean;
  showOwner: boolean;
  /** Eventos importados do Google Agenda da pessoa (ver components/google-calendar-connect.tsx) — só leitura, nunca editáveis aqui. */
  googleEvents?: GoogleEvent[];
  /** Repassado pro TaskDetailModal — habilita o botão "Editar" (ver EditTaskDialog). */
  deals?: Option[];
}) {
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  // Arrastar-e-soltar — seleção múltipla opcional (botão "Selecionar",
  // mesmo padrão de WhatsApp Conversas): arrastar uma tarefa que FAZ parte
  // da seleção move a seleção inteira; arrastar qualquer outra move só ela,
  // sem precisar entrar em "modo seleção" nenhum (a forma mais comum/óbvia
  // de usar isso continua sendo pegar um cartão e soltar em outro dia).
  const [selectMode, setSelectMode] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [activeDrag, setActiveDrag] = useState<{ task: Task; count: number } | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  // Some sozinho depois de um tempo — sem isso, uma falha de arraste ficava
  // no canto da tela pra sempre até a pessoa tentar arrastar de novo (nem dá
  // pra fechar manualmente antes disso, ver botão × abaixo).
  useEffect(() => {
    if (!moveError) return;
    const timeout = setTimeout(() => setMoveError(null), 6000);
    return () => clearTimeout(timeout);
  }, [moveError]);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
  );
  const [selectedGoogleEvent, setSelectedGoogleEvent] = useState<GoogleEvent | null>(null);
  // "selectedTask" abre TaskDetailModal por FORA do TaskRow (a grade do mês
  // mostra bolhas próprias, não TaskRow) — precisa da mesma trava que
  // TaskRow.handleToggle já tem, senão concluir uma Reunião/Visita por aqui
  // pula a pergunta de resultado inteira.
  const { requestComplete, dialog: outcomeDialog } = useMeetingOutcomeGate(onToggle);
  const today = useMemo(() => startOfDay(new Date()), []);

  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - ((monthStart.getDay() + 6) % 7));
  const gridEnd = new Date(monthEnd);
  gridEnd.setDate(monthEnd.getDate() + (7 - ((monthEnd.getDay() + 6) % 7) - 1));

  const days = useMemo(() => {
    const arr: Date[] = [];
    const d = new Date(gridStart);
    while (d <= gridEnd) {
      arr.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridStart.getTime(), gridEnd.getTime()]);

  const tasksByDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.dueAt) continue;
      const key = startOfDay(new Date(t.dueAt)).toDateString();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime());
    }
    return map;
  }, [tasks]);

  const googleEventsByDay = useMemo(() => {
    const map = new Map<string, GoogleEvent[]>();
    for (const e of googleEvents) {
      const key = startOfDay(new Date(e.start)).toDateString();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    }
    return map;
  }, [googleEvents]);

  function toggleTaskSelection(id: string) {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleDragStart(event: DragStartEvent) {
    const task = (event.active.data.current as { task?: Task } | undefined)?.task;
    if (!task) return;
    // Arrastar uma tarefa que FAZ parte da seleção move a seleção inteira
    // (mostra a contagem no overlay); arrastar qualquer outra é sempre só
    // ela, mesmo com uma seleção diferente ativa no momento.
    const count = selectedTaskIds.has(task.id) && selectedTaskIds.size > 1 ? selectedTaskIds.size : 1;
    setActiveDrag({ task, count });
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const dragged = activeDrag;
    setActiveDrag(null);
    if (!over || !dragged || !onBulkMove) return;

    const targetDateKey = over.id as string;
    const draggedTask = (active.data.current as { task?: Task } | undefined)?.task;
    if (!draggedTask?.dueAt) return;
    if (dateKey(new Date(draggedTask.dueAt)) === targetDateKey) return; // soltou no mesmo dia — nada a fazer

    const idsToMove = dragged.count > 1 ? Array.from(selectedTaskIds) : [draggedTask.id];
    setMoveError(null);
    const result = await onBulkMove(idsToMove, targetDateKey);
    if (!result.ok) {
      setMoveError(result.error ?? "Não foi possível mover a(s) tarefa(s)");
      return;
    }
    setSelectedTaskIds(new Set());
    setSelectMode(false);
  }

  return (
    // DndContext precisa ser o wrapper mais externo (não só em volta da
    // grade) — DragOverlay abaixo é `position:fixed`, e diferente de Modal
    // (ver components/modal.tsx, que já resolve isso com createPortal pro
    // document.body), o DragOverlay do @dnd-kit não tem prop de portal
    // nenhuma. Com ele dentro do `.card` logo abaixo, o backdrop-filter do
    // `.card` (mesmo motivo já documentado em modal.tsx) virava o
    // "containing block" do fixed — o cartão fantasma seguia o mouse
    // deslocado, ancorado no canto do `.card` em vez da tela inteira.
    // DndContext em si não renderiza elemento DOM próprio (só contexto),
    // então isso não muda layout nenhum — só tira o DragOverlay de dentro
    // do `.card`.
    <DndContext id="task-calendar" sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
    <div className="card relative p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {MONTH_LABELS[cursor.getMonth()]} {cursor.getFullYear()}
        </h2>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            className="icon-btn"
            aria-label="Mês anterior"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={2} />
          </button>
          <button onClick={() => setCursor(startOfDay(new Date()))} className="btn-ghost btn-sm">
            Hoje
          </button>
          <button
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            className="icon-btn"
            aria-label="Próximo mês"
          >
            <ChevronRight className="h-4 w-4" strokeWidth={2} />
          </button>
          {onBulkMove && (
            <button
              onClick={() => {
                setSelectMode((v) => !v);
                setSelectedTaskIds(new Set());
              }}
              className={`ml-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-all ${
                selectMode
                  ? "border-transparent bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900"
                  : "border-transparent bg-neutral-100 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-700 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800"
              }`}
              title={selectMode ? "Cancelar seleção" : "Selecionar várias tarefas pra arrastar juntas"}
            >
              {selectMode ? "Cancelar" : "Selecionar"}
            </button>
          )}
        </div>
      </div>

      {/* Dica + erro do arraste — position:absolute de propósito, flutuando
          sobre o canto do card (nunca dentro do fluxo normal): pedido
          explícito, entrar/sair da seleção NÃO pode empurrar a grade do mês
          pra cima/baixo. `.card` acima ganhou `relative` só pra ancorar
          isso; `absolute` (não `fixed`, ver comentário do DragOverlay mais
          abaixo) já basta, não precisa escapar de container nenhum. */}
      {((selectMode && selectedTaskIds.size > 0) || moveError) && (
        <div className="pointer-events-none absolute right-3 bottom-3 z-20 flex flex-col items-end gap-1.5">
          {selectMode && selectedTaskIds.size > 0 && (
            <div className="pointer-events-auto">
              <SelectionBar count={selectedTaskIds.size} onClear={() => setSelectedTaskIds(new Set())}>
                <span className="text-neutral-500 dark:text-neutral-400">Arraste uma delas pra outro dia</span>
              </SelectionBar>
            </div>
          )}
          {moveError && (
            <p className="pointer-events-auto flex items-center gap-1.5 rounded-md bg-red-50 py-1.5 pr-1.5 pl-2.5 text-xs text-red-600 shadow-lg dark:bg-red-500/10 dark:text-red-400">
              {moveError}
              <button
                type="button"
                onClick={() => setMoveError(null)}
                className="shrink-0 rounded p-0.5 hover:bg-red-100 dark:hover:bg-red-500/20"
                aria-label="Fechar aviso"
              >
                <X className="h-3 w-3" strokeWidth={2.5} />
              </button>
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-neutral-200 bg-neutral-200 dark:border-neutral-800 dark:bg-neutral-800">
        {WEEKDAY_LABELS.map((w) => (
          <div
            key={w}
            className="bg-neutral-50 px-2 py-1.5 text-center text-xs font-medium text-neutral-500 dark:bg-neutral-950 dark:text-neutral-400"
          >
            {w}
          </div>
        ))}
        {days.map((day) => (
          <DayCell
            key={day.toISOString()}
            day={day}
            inMonth={day.getMonth() === cursor.getMonth()}
            isToday={isSameDay(day, today)}
            today={today}
            dayTasks={tasksByDay.get(day.toDateString()) ?? []}
            dayGoogleEvents={googleEventsByDay.get(day.toDateString()) ?? []}
            showOwner={showOwner}
            draggable={!!onBulkMove}
            selectMode={selectMode}
            selectedTaskIds={selectedTaskIds}
            onToggleTaskSelect={toggleTaskSelection}
            onOpenDay={() => setSelectedDay(day)}
            onOpenTask={(t) => setSelectedTask(t)}
            onOpenGoogleEvent={(e) => setSelectedGoogleEvent(e)}
          />
        ))}
      </div>

      {selectedDay && (
        // max-w-3xl (era xl) + max-h-[75vh] na lista (era 60vh) — o painel
        // do Modal em si já suporta até 90vh (ver components/modal.tsx),
        // mas esse card ficava artificialmente pequeno preso num teto de
        // 60vh dentro de um painel de 576px — bem menos espaço do que o
        // Modal já tinha disponível.
        <Modal onClose={() => setSelectedDay(null)} maxWidth="max-w-3xl">
          <h2 className="mb-4 text-lg font-semibold text-neutral-900 capitalize dark:text-neutral-100">
            {selectedDay.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
          </h2>
          <div className="scrollbar-thin max-h-[75vh] space-y-2.5 overflow-y-auto pb-2">
            {(tasksByDay.get(selectedDay.toDateString()) ?? []).map((t) => (
              <TaskRow key={t.id} task={t} onToggle={onToggle} onDelete={onDelete} canDelete={canDelete} showOwner={showOwner} deals={deals} />
            ))}
            {(googleEventsByDay.get(selectedDay.toDateString()) ?? []).map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => setSelectedGoogleEvent(e)}
                className="card flex w-full items-center gap-3 p-3 text-left text-sm text-blue-700 transition-colors hover:bg-blue-50/60 dark:text-blue-400 dark:hover:bg-blue-500/10"
              >
                <CalendarIcon className="h-4 w-4 shrink-0" strokeWidth={2} />
                <span className="min-w-0 flex-1 truncate">{e.title}</span>
                {!e.allDay && (
                  <span className="shrink-0 text-xs text-blue-500/80 dark:text-blue-400/70">
                    {new Date(e.start).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
              </button>
            ))}
          </div>
        </Modal>
      )}

      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          completed={!!selectedTask.completedAt}
          justCompleted={false}
          onClose={() => setSelectedTask(null)}
          onToggle={() => {
            const next = !selectedTask.completedAt;
            if (next && requestComplete(selectedTask)) {
              setSelectedTask(null);
              return;
            }
            onToggle(selectedTask.id, next);
            setSelectedTask(null);
          }}
          canDelete={canDelete}
          onDelete={onDelete}
          deals={deals}
        />
      )}

      {selectedGoogleEvent && (
        <GoogleEventDetailModal event={selectedGoogleEvent} onClose={() => setSelectedGoogleEvent(null)} />
      )}
      {outcomeDialog}
    </div>
    <DragOverlay>
      {activeDrag ? (
        activeDrag.count > 1 ? (
          <div className="flex items-center gap-1.5 rounded-md bg-neutral-800 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg dark:bg-neutral-100 dark:text-neutral-900">
            <Layers className="h-3.5 w-3.5" strokeWidth={2} />
            {activeDrag.count} tarefas
          </div>
        ) : (
          <TaskPillContent task={activeDrag.task} overdue={!activeDrag.task.completedAt && new Date(activeDrag.task.dueAt!) < today} showOwner={showOwner} overlay />
        )
      ) : null}
    </DragOverlay>
    </DndContext>
  );
}

/**
 * Uma célula de dia da grade do mês — extraída da própria TaskCalendar de
 * propósito: useDroppable precisa rodar uma vez por dia, e chamar hook
 * dentro do .map() de `days` (35 ou 42 por mês, dependendo de quantas
 * semanas o mês cobre) quebra a regra de hooks (a contagem de chamadas
 * mudaria de render pra render conforme o mês muda). Mesmo motivo de
 * DealCard ser um componente próprio em kanban-board.tsx.
 */
function DayCell({
  day,
  inMonth,
  isToday,
  today,
  dayTasks,
  dayGoogleEvents,
  showOwner,
  draggable,
  selectMode,
  selectedTaskIds,
  onToggleTaskSelect,
  onOpenDay,
  onOpenTask,
  onOpenGoogleEvent,
}: {
  day: Date;
  inMonth: boolean;
  isToday: boolean;
  today: Date;
  dayTasks: Task[];
  dayGoogleEvents: GoogleEvent[];
  showOwner: boolean;
  draggable: boolean;
  selectMode: boolean;
  selectedTaskIds: Set<string>;
  onToggleTaskSelect: (id: string) => void;
  onOpenDay: () => void;
  onOpenTask: (task: Task) => void;
  onOpenGoogleEvent: (event: GoogleEvent) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dateKey(day), disabled: !draggable });
  const visible = dayTasks.slice(0, 3);
  const visibleGoogle = dayGoogleEvents.slice(0, Math.max(0, 3 - visible.length));
  const overflow = dayTasks.length - visible.length + (dayGoogleEvents.length - visibleGoogle.length);

  return (
    <div
      ref={setNodeRef}
      onClick={onOpenDay}
      className={`min-h-[104px] p-1.5 cursor-pointer transition-colors ${
        isOver
          ? "bg-brand-light dark:bg-brand/15"
          : `hover:bg-neutral-50/80 dark:hover:bg-neutral-800/20 ${inMonth ? "bg-white dark:bg-neutral-900" : "bg-neutral-50/60 dark:bg-neutral-900/40"}`
      } ${isToday ? "ring-1 ring-inset ring-neutral-900 dark:ring-white" : ""}`}
    >
      <span
        className={`mb-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${
          isToday
            ? "bg-neutral-900 font-semibold text-white dark:bg-white dark:text-neutral-900"
            : inMonth
              ? "text-neutral-700 dark:text-neutral-300"
              : "text-neutral-300 dark:text-neutral-600"
        }`}
      >
        {day.getDate()}
      </span>
      <div className="space-y-0.5">
        {visible.map((t) => (
          <TaskPill
            key={t.id}
            task={t}
            overdue={!t.completedAt && new Date(t.dueAt!) < today}
            showOwner={showOwner}
            draggable={draggable}
            selectMode={selectMode}
            selected={selectedTaskIds.has(t.id)}
            onToggleSelect={() => onToggleTaskSelect(t.id)}
            onOpen={() => onOpenTask(t)}
          />
        ))}
        {visibleGoogle.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={(ev) => {
              ev.stopPropagation();
              onOpenGoogleEvent(e);
            }}
            title={e.title}
            className="flex w-full items-center gap-1 truncate rounded bg-blue-50 px-1 py-0.5 text-left text-[11px] text-blue-700 transition-colors hover:brightness-95 dark:bg-blue-500/10 dark:text-blue-400"
          >
            <CalendarIcon className="h-2.5 w-2.5 shrink-0" strokeWidth={2} />
            <span className="truncate">{e.title}</span>
          </button>
        ))}
        {overflow > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenDay();
            }}
            className="px-1 text-[11px] font-medium text-neutral-400 hover:text-neutral-900 dark:text-neutral-500 dark:hover:text-neutral-100"
          >
            +{overflow} mais
          </button>
        )}
      </div>
    </div>
  );
}

/** Ícone + título + avatar de uma tarefa — sem interação nenhuma, reaproveitado
 * pelo cartão "fantasma" que segue o cursor durante o arraste (DragOverlay,
 * ver TaskCalendar) e por dentro do TaskPill de verdade abaixo. */
function TaskPillContent({
  task,
  overdue,
  showOwner,
  overlay = false,
}: {
  task: Task;
  overdue: boolean;
  showOwner: boolean;
  overlay?: boolean;
}) {
  const Icon = TASK_TYPE_ICON[task.type] ?? TASK_TYPE_ICON.OTHER;
  const color = TASK_TYPE_COLOR[task.type] ?? TASK_TYPE_COLOR.OTHER;
  return (
    <div
      className={`flex min-w-0 items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px] ${overlay ? "shadow-lg" : ""} ${
        task.completedAt
          ? "text-neutral-400 line-through dark:text-neutral-500"
          : `${color.bg} ${color.text} ${overdue ? "ring-1 ring-inset ring-red-500" : ""}`
      }`}
    >
      <Icon className="h-2.5 w-2.5 shrink-0" strokeWidth={2} />
      <span className="truncate">{task.title}</span>
      {showOwner && <Avatar name={task.owner.name} src={task.owner.photoUrl} size="2xs" className="ml-auto shrink-0" />}
    </div>
  );
}

/**
 * Uma tarefa na grade do mês — arrastável (dnd-kit) quando `draggable`.
 * Concluída nunca é arrastável (já aconteceu, mover de dia não faz
 * sentido) nem selecionável, mesmo com "Selecionar" ativo — continua só
 * abrindo o detalhe ao clicar, igual sempre foi.
 *
 * Checkbox de seleção IRMÃO do botão (não dentro dele) — mesmo motivo já
 * documentado em conversations-view.tsx: evita botão-dentro-de-botão.
 */
function TaskPill({
  task,
  overdue,
  showOwner,
  draggable,
  selectMode,
  selected,
  onToggleSelect,
  onOpen,
}: {
  task: Task;
  overdue: boolean;
  showOwner: boolean;
  draggable: boolean;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
}) {
  const canDrag = draggable && !task.completedAt;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { task },
    disabled: !canDrag,
  });
  const canSelect = canDrag && selectMode;

  return (
    <div className={`flex items-center gap-0.5 ${isDragging ? "opacity-30" : ""}`}>
      {canSelect && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
          aria-label={selected ? "Desmarcar tarefa" : "Selecionar tarefa"}
          className="shrink-0 rounded p-0.5 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/60"
        >
          {selected ? (
            <CheckSquare className="h-3 w-3 text-brand" strokeWidth={2} />
          ) : (
            <Square className="h-3 w-3 text-neutral-300 dark:text-neutral-600" strokeWidth={2} />
          )}
        </button>
      )}
      <button
        ref={setNodeRef}
        type="button"
        {...(canDrag ? listeners : {})}
        {...(canDrag ? attributes : {})}
        onClick={(e) => {
          e.stopPropagation();
          if (canSelect) onToggleSelect();
          else onOpen();
        }}
        className={`min-w-0 flex-1 text-left transition-transform duration-150 hover:scale-[1.03] hover:shadow-sm active:scale-[0.97] ${
          canDrag ? "touch-manipulation cursor-grab active:cursor-grabbing" : ""
        } ${selected ? "ring-2 ring-inset ring-brand rounded" : ""}`}
      >
        <TaskPillContent task={task} overdue={overdue} showOwner={showOwner} />
      </button>
    </div>
  );
}
