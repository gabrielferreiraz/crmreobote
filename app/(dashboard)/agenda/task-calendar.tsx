"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";
import { Modal } from "@/components/modal";
import { Avatar } from "@/components/avatar";
import { TASK_TYPE_ICON, TASK_TYPE_COLOR } from "@/lib/task-icons";
import { TaskRow, type Task } from "./task-row";
import { TaskDetailModal } from "./task-detail-modal";

export type GoogleEvent = { id: string; title: string; start: string; allDay: boolean; htmlLink: string };

const WEEKDAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
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

export function TaskCalendar({
  tasks,
  onToggle,
  showOwner,
  googleEvents = [],
}: {
  tasks: Task[];
  onToggle: (id: string, completed: boolean) => void;
  showOwner: boolean;
  /** Eventos importados do Google Agenda da pessoa (ver components/google-calendar-connect.tsx) — só leitura, nunca editáveis aqui. */
  googleEvents?: GoogleEvent[];
}) {
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
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
    <div className="card p-4">
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
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-neutral-200 bg-neutral-200 dark:border-neutral-800 dark:bg-neutral-800">
        {WEEKDAY_LABELS.map((w) => (
          <div
            key={w}
            className="bg-neutral-50 px-2 py-1.5 text-center text-xs font-medium text-neutral-500 dark:bg-neutral-950 dark:text-neutral-400"
          >
            {w}
          </div>
        ))}
        {days.map((day) => {
          const inMonth = day.getMonth() === cursor.getMonth();
          const isToday = isSameDay(day, today);
          const dayTasks = tasksByDay.get(day.toDateString()) ?? [];
          const dayGoogleEvents = googleEventsByDay.get(day.toDateString()) ?? [];
          const visible = dayTasks.slice(0, 3);
          const visibleGoogle = dayGoogleEvents.slice(0, Math.max(0, 3 - visible.length));
          const overflow = dayTasks.length - visible.length + (dayGoogleEvents.length - visibleGoogle.length);

          return (
            <div
              key={day.toISOString()}
              onClick={() => setSelectedDay(day)}
              className={`min-h-[104px] p-1.5 cursor-pointer hover:bg-neutral-50/80 dark:hover:bg-neutral-800/20 transition-colors ${inMonth ? "bg-white dark:bg-neutral-900" : "bg-neutral-50/60 dark:bg-neutral-900/40"} ${
                isToday ? "ring-1 ring-inset ring-neutral-900 dark:ring-white" : ""
              }`}
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
                {visible.map((t) => {
                  const Icon = TASK_TYPE_ICON[t.type] ?? TASK_TYPE_ICON.OTHER;
                  const color = TASK_TYPE_COLOR[t.type] ?? TASK_TYPE_COLOR.OTHER;
                  const overdue = !t.completedAt && new Date(t.dueAt!) < today;
                  return (
                    <button
                      key={t.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedTask(t);
                      }}
                      className={`flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-[11px] transition-all duration-150 hover:scale-[1.03] hover:shadow-sm active:scale-[0.97] ${
                        t.completedAt
                          ? "text-neutral-400 line-through hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
                          : `${color.bg} ${color.text} hover:brightness-90 dark:hover:brightness-110 ${overdue ? "ring-1 ring-inset ring-red-500" : ""}`
                      }`}
                    >
                      <Icon className="h-2.5 w-2.5 shrink-0" strokeWidth={2} />
                      <span className="truncate">{t.title}</span>
                      {showOwner && (
                        <Avatar name={t.owner.name} src={t.owner.photoUrl} size="2xs" className="ml-auto shrink-0" />
                      )}
                    </button>
                  );
                })}
                {visibleGoogle.map((e) => (
                  <a
                    key={e.id}
                    href={e.htmlLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    title={e.title}
                    className="flex w-full items-center gap-1 truncate rounded bg-blue-50 px-1 py-0.5 text-left text-[11px] text-blue-700 transition-colors hover:brightness-95 dark:bg-blue-500/10 dark:text-blue-400"
                  >
                    <CalendarIcon className="h-2.5 w-2.5 shrink-0" strokeWidth={2} />
                    <span className="truncate">{e.title}</span>
                  </a>
                ))}
                {overflow > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedDay(day);
                    }}
                    className="px-1 text-[11px] font-medium text-neutral-400 hover:text-neutral-900 dark:text-neutral-500 dark:hover:text-neutral-100"
                  >
                    +{overflow} mais
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selectedDay && (
        <Modal onClose={() => setSelectedDay(null)} maxWidth="max-w-xl">
          <h2 className="mb-3 text-sm font-semibold text-neutral-900 capitalize dark:text-neutral-100">
            {selectedDay.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
          </h2>
          <div className="scrollbar-thin max-h-[60vh] space-y-2 overflow-y-auto">
            {(tasksByDay.get(selectedDay.toDateString()) ?? []).map((t) => (
              <TaskRow key={t.id} task={t} onToggle={onToggle} showOwner={showOwner} />
            ))}
            {(googleEventsByDay.get(selectedDay.toDateString()) ?? []).map((e) => (
              <a
                key={e.id}
                href={e.htmlLink}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="card flex items-center gap-3 p-3 text-sm text-blue-700 transition-colors hover:bg-blue-50/60 dark:text-blue-400 dark:hover:bg-blue-500/10"
              >
                <CalendarIcon className="h-4 w-4 shrink-0" strokeWidth={2} />
                <span className="min-w-0 flex-1 truncate">{e.title}</span>
                {!e.allDay && (
                  <span className="shrink-0 text-xs text-blue-500/80 dark:text-blue-400/70">
                    {new Date(e.start).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
              </a>
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
            onToggle(selectedTask.id, next);
            setSelectedTask(null);
          }}
        />
      )}
    </div>
  );
}
