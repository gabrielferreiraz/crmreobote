"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";
import { Modal } from "@/components/modal";
import { TASK_TYPE_COLOR } from "@/lib/task-icons";
import { TaskRow, type Task } from "./task-row";
import { GoogleEventDetailModal } from "./google-event-detail-modal";
import type { GoogleEvent } from "./task-calendar";
import type { Option } from "./tasks-list";

const WEEKDAY_LABELS = ["S", "T", "Q", "Q", "S", "S", "D"];
const MONTH_LABELS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Versão pequena do calendário, só pra visualização no celular — a grade
 * completa (ver task-calendar.tsx) tem bolhas de tarefa com texto, boas no
 * mouse mas minúsculas demais pro toque; aqui cada dia é só um número com
 * até 3 pontinhos coloridos, e tocar num dia com compromisso abre a lista
 * dele num modal (sem arrastar nada, sem editar aqui).
 */
export function CompactMonthCalendar({
  tasks,
  onToggle,
  onDelete,
  canDelete,
  showOwner,
  deals,
  googleEvents = [],
}: {
  tasks: Task[];
  onToggle: (id: string, completed: boolean) => void;
  onDelete?: (id: string) => Promise<void> | void;
  /** Qualquer papel com acesso à tarefa pode excluir — ver TaskDetailModal. */
  canDelete?: boolean;
  showOwner: boolean;
  /** Repassado pro TaskDetailModal — habilita o botão "Editar" (ver EditTaskDialog). */
  deals?: Option[];
  /** Eventos do Google Agenda — mesma fonte que a grade do desktop
   * (task-calendar.tsx). Faltava aqui: a versão mobile nunca mostrava
   * Google Agenda nenhum, só a grade de desktop mostrava — mesmo dado, só
   * não estava sendo repassado pra esta versão. */
  googleEvents?: GoogleEvent[];
}) {
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [selectedGoogleEvent, setSelectedGoogleEvent] = useState<GoogleEvent | null>(null);
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

  return (
    <div className="card p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {MONTH_LABELS[cursor.getMonth()]} {cursor.getFullYear()}
        </h2>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            className="icon-btn h-7 w-7"
            aria-label="Mês anterior"
          >
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
          <button onClick={() => setCursor(startOfDay(new Date()))} className="btn-ghost btn-sm px-2">
            Hoje
          </button>
          <button
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            className="icon-btn h-7 w-7"
            aria-label="Próximo mês"
          >
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 text-center text-[10px] font-medium text-neutral-400 dark:text-neutral-500">
        {WEEKDAY_LABELS.map((w, i) => (
          <span key={i} className="py-1">
            {w}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-0.5">
        {days.map((day) => {
          const inMonth = day.getMonth() === cursor.getMonth();
          const isToday = isSameDay(day, today);
          const dayTasks = tasksByDay.get(day.toDateString()) ?? [];
          const dayGoogleEvents = googleEventsByDay.get(day.toDateString()) ?? [];
          const hasAny = dayTasks.length > 0 || dayGoogleEvents.length > 0;
          // Pontinho de tarefa tem prioridade — Google só preenche o que
          // sobrar até 3 (mesma regra de "visible"/"visibleGoogle" da grade
          // de desktop, ver task-calendar.tsx).
          const taskDots = dayTasks.slice(0, 3);
          const googleDots = dayGoogleEvents.slice(0, Math.max(0, 3 - taskDots.length));

          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => hasAny && setSelectedDay(day)}
              disabled={!hasAny}
              className="flex h-11 flex-col items-center justify-center gap-0.5 rounded-md active:scale-[0.97] disabled:cursor-default"
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                  isToday
                    ? "bg-neutral-900 font-semibold text-white dark:bg-white dark:text-neutral-900"
                    : inMonth
                      ? "text-neutral-700 dark:text-neutral-300"
                      : "text-neutral-300 dark:text-neutral-600"
                }`}
              >
                {day.getDate()}
              </span>
              <span className="flex h-1 items-center gap-0.5">
                {taskDots.map((t, i) => (
                  <span key={`t${i}`} className={`h-1 w-1 rounded-full ${TASK_TYPE_COLOR[t.type]?.dot ?? "bg-neutral-400"}`} />
                ))}
                {googleDots.map((_, i) => (
                  <span key={`g${i}`} className="h-1 w-1 rounded-full bg-blue-500" />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      {selectedDay && (
        <Modal onClose={() => setSelectedDay(null)} maxWidth="max-w-2xl">
          <h2 className="mb-4 text-lg font-semibold text-neutral-900 capitalize dark:text-neutral-100">
            {selectedDay.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
          </h2>
          <div className="scrollbar-thin max-h-[72vh] space-y-2.5 overflow-y-auto pb-2">
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

      {selectedGoogleEvent && (
        <GoogleEventDetailModal event={selectedGoogleEvent} onClose={() => setSelectedGoogleEvent(null)} />
      )}
    </div>
  );
}
