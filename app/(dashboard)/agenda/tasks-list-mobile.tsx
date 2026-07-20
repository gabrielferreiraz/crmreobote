"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, Search, SearchX } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { FilterPopover } from "@/components/filter-popover";
import { Select } from "@/components/select";
import { TASK_TYPE_LABELS, TASK_TYPE_COLOR } from "@/lib/task-icons";
import { TaskRow, type Task } from "./task-row";
import { NewTaskDialog, type Option } from "./tasks-list";
import { GoogleCalendarBanner } from "./google-calendar-banner";
import { UpcomingAppointmentsCard } from "./upcoming-appointments-card";
import { CompactMonthCalendar } from "./compact-month-calendar";

function groupTasks(tasks: Task[]) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);

  const pending = tasks.filter((t) => !t.completedAt);
  const completed = tasks.filter((t) => t.completedAt);

  const overdue = pending.filter((t) => t.dueAt && new Date(t.dueAt) < startOfToday);
  const today = pending.filter(
    (t) => t.dueAt && new Date(t.dueAt) >= startOfToday && new Date(t.dueAt) < endOfToday,
  );
  const upcoming = pending.filter((t) => t.dueAt && new Date(t.dueAt) >= endOfToday);
  const noDate = pending.filter((t) => !t.dueAt);

  return { overdue, today, upcoming, noDate, completed };
}

/**
 * Agenda no celular: o calendário em grade do desktop fica minúsculo demais
 * pra usar no toque, então aqui a lista agrupada por prazo (que já existia
 * como alternativa no desktop) vira o padrão único — sem alternância de
 * visão pra não competir por espaço na tela.
 */
export function TasksListMobile({
  initialTasks,
  deals,
  members,
  openNewTask,
  isGoogleConnected,
  isWhatsAppConnected,
  googleParam,
}: {
  initialTasks: Task[];
  deals: Option[];
  members: Option[];
  openNewTask?: boolean;
  isGoogleConnected: boolean;
  isWhatsAppConnected: boolean;
  googleParam?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilters, setTypeFilters] = useState<Set<string>>(new Set());
  const [ownerFilter, setOwnerFilter] = useState("");
  const showOwner = members.length > 1;

  useEffect(() => {
    if (openNewTask) {
      setOpen(true);
      router.replace("/agenda");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNewTask]);

  const hasFilters = !!search || typeFilters.size > 0 || !!ownerFilter;

  function clearFilters() {
    setSearch("");
    setTypeFilters(new Set());
    setOwnerFilter("");
  }

  function toggleType(type: string) {
    setTypeFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  const filteredTasks = useMemo(() => {
    const term = search.trim().toLowerCase();
    return initialTasks.filter((t) => {
      if (
        term &&
        !t.title.toLowerCase().includes(term) &&
        !(t.description ?? "").toLowerCase().includes(term) &&
        !(t.deal?.name ?? "").toLowerCase().includes(term) &&
        !(t.contact?.name ?? "").toLowerCase().includes(term)
      ) {
        return false;
      }
      if (typeFilters.size > 0 && !typeFilters.has(t.type)) return false;
      if (ownerFilter && t.owner.id !== ownerFilter) return false;
      return true;
    });
  }, [initialTasks, search, typeFilters, ownerFilter]);

  const groups = useMemo(() => groupTasks(filteredTasks), [filteredTasks]);
  const isEmpty = initialTasks.length === 0;
  const noResults = !isEmpty && filteredTasks.length === 0;

  async function toggleComplete(taskId: string, completed: boolean) {
    await fetch(`/api/tasks/${taskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed }),
    });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <GoogleCalendarBanner isGoogleConnected={isGoogleConnected} googleParam={googleParam} />

      <UpcomingAppointmentsCard tasks={initialTasks} onToggle={toggleComplete} />

      {!isEmpty && <CompactMonthCalendar tasks={initialTasks} onToggle={toggleComplete} showOwner={showOwner} />}

      {!isEmpty && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
              strokeWidth={2}
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar tarefa, negócio ou contato"
              className="field-input py-2 pl-8 text-sm"
            />
          </div>
          <FilterPopover active={hasFilters} onClear={clearFilters}>
            <div className="space-y-1">
              <label className="field-label">Categoria</label>
              <div className="flex flex-wrap gap-1">
                {Object.entries(TASK_TYPE_LABELS).map(([value, label]) => {
                  const color = TASK_TYPE_COLOR[value];
                  const active = typeFilters.has(value);
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => toggleType(value)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium transition-colors active:scale-[0.97] ${
                        active
                          ? "border-neutral-900 dark:border-white"
                          : "border-transparent active:border-neutral-200 dark:active:border-neutral-700"
                      } ${color.bg} ${color.text}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${color.dot}`} />
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            {members.length > 1 && (
              <div className="space-y-1">
                <label className="field-label">Responsável</label>
                <Select
                  value={ownerFilter}
                  onChange={setOwnerFilter}
                  className="w-full py-1.5 text-sm"
                  options={[
                    { value: "", label: "Todos" },
                    ...members.map((m) => ({ value: m.id, label: m.name })),
                  ]}
                />
              </div>
            )}
          </FilterPopover>
        </div>
      )}

      {isEmpty ? (
        <div className="card">
          <EmptyState
            icon={CheckSquare}
            title="Nenhuma atividade por aqui"
            description="Toque no + pra criar sua primeira atividade."
          />
        </div>
      ) : noResults ? (
        <div className="card">
          <EmptyState icon={SearchX} title="Nenhuma atividade encontrada" description="Ajuste a busca ou limpe os filtros." />
        </div>
      ) : (
        <div className="space-y-5">
          <MobileTaskGroup title="Atrasadas" tasks={groups.overdue} tone="red" onToggle={toggleComplete} showOwner={showOwner} />
          <MobileTaskGroup title="Hoje" tasks={groups.today} onToggle={toggleComplete} showOwner={showOwner} />
          <MobileTaskGroup title="Próximas" tasks={groups.upcoming} onToggle={toggleComplete} showOwner={showOwner} />
          <MobileTaskGroup title="Sem prazo" tasks={groups.noDate} onToggle={toggleComplete} showOwner={showOwner} />
          <MobileTaskGroup title="Concluídas" tasks={groups.completed} onToggle={toggleComplete} muted showOwner={showOwner} />
        </div>
      )}

      {open && (
        <NewTaskDialog
          deals={deals}
          isWhatsAppConnected={isWhatsAppConnected}
          onClose={() => setOpen(false)}
          onCreated={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function MobileTaskGroup({
  title,
  tasks,
  tone,
  muted,
  onToggle,
  showOwner,
}: {
  title: string;
  tasks: Task[];
  tone?: "red";
  muted?: boolean;
  onToggle: (id: string, completed: boolean) => void;
  showOwner: boolean;
}) {
  if (tasks.length === 0) return null;

  return (
    <div>
      <h2
        className={`mb-2 text-sm font-medium ${
          tone === "red" ? "text-red-600 dark:text-red-400" : "text-neutral-700 dark:text-neutral-300"
        }`}
      >
        {title} ({tasks.length})
      </h2>
      <div className="space-y-2">
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} onToggle={onToggle} muted={muted} showOwner={showOwner} />
        ))}
      </div>
    </div>
  );
}
