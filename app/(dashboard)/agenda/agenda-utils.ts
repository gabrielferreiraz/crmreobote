import type { Task } from "./task-row";

export type AgendaFocus = "all" | "overdue" | "today" | "upcoming" | "noDate";

export function groupAgendaTasks(tasks: Task[]) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);

  const pending = tasks.filter((task) => !task.completedAt);
  const completed = tasks.filter((task) => task.completedAt);
  const overdue = pending.filter((task) => task.dueAt && new Date(task.dueAt) < startOfToday);
  const today = pending.filter(
    (task) => task.dueAt && new Date(task.dueAt) >= startOfToday && new Date(task.dueAt) < endOfToday,
  );
  const upcoming = pending.filter((task) => task.dueAt && new Date(task.dueAt) >= endOfToday);
  const noDate = pending.filter((task) => !task.dueAt);

  return { pending, overdue, today, upcoming, noDate, completed };
}
