"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, Search, SearchX } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { FilterPopover } from "@/components/filter-popover";
import { Select } from "@/components/select";
import { TASK_TYPE_LABELS, TASK_TYPE_COLOR } from "@/lib/task-icons";
import type { GoogleCalendarState } from "@/lib/use-google-calendar-events";
import { TaskRow, type Task } from "./task-row";
import { NewTaskDialog, type Option } from "./tasks-list";
import { GoogleCalendarBanner } from "./google-calendar-banner";
import { UpcomingAppointmentsCard } from "./upcoming-appointments-card";
import { useUndoToast } from "@/components/undo-provider";
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
  isWhatsAppConnected,
  googleParam,
  googleCalendar,
  tasksTruncated,
}: {
  initialTasks: Task[];
  deals: Option[];
  members: Option[];
  openNewTask?: boolean;
  isWhatsAppConnected: boolean;
  googleParam?: string;
  /** Buscado uma vez só em AgendaClient e repassado pra cá e pra TasksList
   * (desktop) — ver comentário lá; nunca chamar useGoogleCalendarEvents()
   * de novo aqui. */
  googleCalendar: GoogleCalendarState;
  /** true quando a consulta no servidor bateu no teto de segurança
   * (TASKS_FETCH_CAP, ver page.tsx) — existe mais tarefa que não veio. */
  tasksTruncated: boolean;
}) {
  const router = useRouter();
  const pushUndoToast = useUndoToast();
  // Excluir tarefa era restrito ao Dono — pedido explícito reverteu isso,
  // agora qualquer papel com acesso à tarefa pode (backend já valida o
  // escopo real, isto aqui só decide se o botão aparece).
  const canDelete = true;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilters, setTypeFilters] = useState<Set<string>>(new Set());
  const [ownerFilter, setOwnerFilter] = useState("");
  // Mesmo padrão de tasks-list.tsx (desktop) — "Pendentes" como padrão,
  // concluir uma tarefa some ela da tela sem precisar mexer em filtro.
  const [statusFilter, setStatusFilter] = useState<"pending" | "completed" | "all">("pending");
  const showOwner = members.length > 1;

  useEffect(() => {
    if (openNewTask) {
      setOpen(true);
      router.replace("/agenda");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNewTask]);

  const hasFilters = !!search || typeFilters.size > 0 || !!ownerFilter || statusFilter !== "pending";

  function clearFilters() {
    setSearch("");
    setTypeFilters(new Set());
    setOwnerFilter("");
    setStatusFilter("pending");
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
      if (statusFilter === "pending" && t.completedAt) return false;
      if (statusFilter === "completed" && !t.completedAt) return false;
      return true;
    });
  }, [initialTasks, search, typeFilters, ownerFilter, statusFilter]);

  const groups = useMemo(() => groupTasks(filteredTasks), [filteredTasks]);
  const isEmpty = initialTasks.length === 0;
  const noResults = !isEmpty && filteredTasks.length === 0;

  // Mesma regra do desktop (tasks-list.tsx): evento do Google não tem
  // "responsável" nem "tipo" no sentido do CRM, então filtrar por consultor
  // ou por categoria não tem como incluí-lo de verdade — some quando um dos
  // dois filtros está ativo.
  const showGoogleEvents = !ownerFilter && typeFilters.size === 0;

  async function toggleComplete(
    taskId: string,
    completed: boolean,
    meetingOutcome?: "ATTENDED" | "NO_SHOW" | "RESCHEDULED",
    newDueAt?: string,
  ) {
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        meetingOutcome === "RESCHEDULED"
          ? { meetingOutcome, dueAt: newDueAt }
          : { completed, ...(meetingOutcome ? { meetingOutcome } : {}) },
      ),
    });
    const data = await res.json().catch(() => ({}));
    router.refresh();
    pushUndoToast(data.undo);
  }

  async function deleteTask(taskId: string) {
    const res = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    router.refresh();
    pushUndoToast(data.undo);
  }

  return (
    <div className="space-y-4">
      <GoogleCalendarBanner
        isGoogleConnected={googleCalendar.connected}
        loading={googleCalendar.loading}
        googleParam={googleParam}
      />

      {tasksTruncated && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400">
          Existem mais tarefas do que a Agenda consegue mostrar de uma vez — algumas podem não estar
          aparecendo aqui. Tente um filtro mais específico (por consultor ou tipo) pra ver o que falta.
        </p>
      )}

      <UpcomingAppointmentsCard tasks={initialTasks} onToggle={toggleComplete} onDelete={deleteTask} canDelete={canDelete} deals={deals} googleEvents={googleCalendar.events} />

      {!isEmpty && (
        <CompactMonthCalendar
          tasks={initialTasks}
          onToggle={toggleComplete}
          onDelete={deleteTask}
          canDelete={canDelete}
          showOwner={showOwner}
          deals={deals}
          googleEvents={showGoogleEvents ? googleCalendar.events : []}
        />
      )}

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
              <label className="field-label">Status</label>
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    { value: "pending" as const, label: "Pendentes" },
                    { value: "completed" as const, label: "Finalizadas" },
                    { value: "all" as const, label: "Todas" },
                  ]
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setStatusFilter(opt.value)}
                    className={`rounded-full border px-2 py-1 text-xs font-medium transition-colors ${
                      statusFilter === opt.value
                        ? "border-neutral-900 bg-neutral-100 text-neutral-900 dark:border-white dark:bg-neutral-800 dark:text-white"
                        : "border-transparent text-neutral-500 hover:border-neutral-200 dark:text-neutral-400 dark:hover:border-neutral-700"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
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
          <MobileTaskGroup title="Atrasadas" tasks={groups.overdue} tone="red" onToggle={toggleComplete} onDelete={deleteTask} canDelete={canDelete} showOwner={showOwner} deals={deals} />
          <MobileTaskGroup title="Hoje" tasks={groups.today} onToggle={toggleComplete} onDelete={deleteTask} canDelete={canDelete} showOwner={showOwner} deals={deals} />
          <MobileTaskGroup title="Próximas" tasks={groups.upcoming} onToggle={toggleComplete} onDelete={deleteTask} canDelete={canDelete} showOwner={showOwner} deals={deals} />
          <MobileTaskGroup title="Sem prazo" tasks={groups.noDate} onToggle={toggleComplete} onDelete={deleteTask} canDelete={canDelete} showOwner={showOwner} deals={deals} />
          <MobileTaskGroup title="Concluídas (últimos 30 dias)" tasks={groups.completed} onToggle={toggleComplete} onDelete={deleteTask} canDelete={canDelete} muted showOwner={showOwner} deals={deals} />
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
  onDelete,
  canDelete,
  showOwner,
  deals,
}: {
  title: string;
  tasks: Task[];
  tone?: "red";
  muted?: boolean;
  onToggle: (id: string, completed: boolean) => void;
  onDelete?: (id: string) => Promise<void> | void;
  canDelete?: boolean;
  showOwner: boolean;
  deals?: Option[];
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
          <TaskRow key={task.id} task={task} onToggle={onToggle} onDelete={onDelete} canDelete={canDelete} muted={muted} showOwner={showOwner} deals={deals} />
        ))}
      </div>
    </div>
  );
}
