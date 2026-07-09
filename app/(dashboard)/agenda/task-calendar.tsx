"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Modal } from "@/components/modal";
import { TASK_TYPE_ICON, TASK_TYPE_COLOR } from "@/lib/task-icons";
import { TaskRow, type Task } from "./task-row";

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
}: {
  tasks: Task[];
  onToggle: (id: string, completed: boolean) => void;
  showOwner: boolean;
}) {
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
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
          const visible = dayTasks.slice(0, 3);
          const overflow = dayTasks.length - visible.length;

          return (
            <div
              key={day.toISOString()}
              className={`min-h-[104px] p-1.5 ${inMonth ? "bg-white dark:bg-neutral-900" : "bg-neutral-50/60 dark:bg-neutral-900/40"} ${
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
                      onClick={() => setSelectedDay(day)}
                      className={`flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] transition-colors ${
                        t.completedAt
                          ? "text-neutral-400 line-through dark:text-neutral-500"
                          : `${color.bg} ${color.text} hover:brightness-95 ${overdue ? "ring-1 ring-inset ring-red-500" : ""}`
                      }`}
                    >
                      <Icon className="h-2.5 w-2.5 shrink-0" strokeWidth={2} />
                      <span className="truncate">{t.title}</span>
                    </button>
                  );
                })}
                {overflow > 0 && (
                  <button
                    onClick={() => setSelectedDay(day)}
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
        <Modal onClose={() => setSelectedDay(null)}>
          <h2 className="mb-3 text-sm font-semibold text-neutral-900 capitalize dark:text-neutral-100">
            {selectedDay.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
          </h2>
          <div className="scrollbar-thin max-h-[60vh] space-y-2 overflow-y-auto">
            {(tasksByDay.get(selectedDay.toDateString()) ?? []).map((t) => (
              <TaskRow key={t.id} task={t} onToggle={onToggle} showOwner={showOwner} />
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
