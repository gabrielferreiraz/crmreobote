"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, CheckSquare, List, Plus, Search, SearchX } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { FilterPopover } from "@/components/filter-popover";
import { sortAlpha } from "@/lib/sort-alpha";
import { Select } from "@/components/select";
import { TASK_TYPE_LABELS, TASK_TYPE_COLOR } from "@/lib/task-icons";
import type { GoogleCalendarState } from "@/lib/use-google-calendar-events";
import { TaskRow, type Task } from "./task-row";
import { NewTaskDialog } from "@/components/new-task-dialog";
import type { Option } from "./tasks-list";
import { GoogleCalendarBanner } from "./google-calendar-banner";
import { UpcomingAppointmentsCard } from "./upcoming-appointments-card";
import { useUndoToast } from "@/components/undo-provider";
import { CompactMonthCalendar } from "./compact-month-calendar";
import { trackUse } from "@/lib/feature-usage/track";
import { requestJson } from "@/lib/client-request";
import { AgendaSummary } from "./agenda-summary";
import { groupAgendaTasks, type AgendaFocus } from "./agenda-utils";

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
  const taskDialogOpen = open || !!openNewTask;
  const [view, setView] = useState<"list" | "calendar">("list");
  const [search, setSearch] = useState("");
  const [typeFilters, setTypeFilters] = useState<Set<string>>(new Set());
  const [ownerFilter, setOwnerFilter] = useState("");
  // Mesmo padrão de tasks-list.tsx (desktop) — "Pendentes" como padrão,
  // concluir uma tarefa some ela da tela sem precisar mexer em filtro.
  const [statusFilter, setStatusFilter] = useState<"pending" | "completed" | "all">("pending");
  const [focusFilter, setFocusFilter] = useState<AgendaFocus>("all");
  const showOwner = members.length > 1;

  const hasFilters =
    !!search || typeFilters.size > 0 || !!ownerFilter || statusFilter !== "pending" || focusFilter !== "all";

  function clearFilters() {
    setSearch("");
    setTypeFilters(new Set());
    setOwnerFilter("");
    setStatusFilter("pending");
    setFocusFilter("all");
  }

  function toggleType(type: string) {
    setTypeFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  const scopedTasks = useMemo(() => {
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

  const summaryGroups = useMemo(() => groupAgendaTasks(scopedTasks), [scopedTasks]);
  const filteredTasks = useMemo(() => {
    const focusedTasks = focusFilter === "all" ? scopedTasks : summaryGroups[focusFilter];
    return focusedTasks.filter((t) => {
      if (statusFilter === "pending" && t.completedAt) return false;
      if (statusFilter === "completed" && !t.completedAt) return false;
      return true;
    });
  }, [scopedTasks, statusFilter, focusFilter, summaryGroups]);

  const groups = useMemo(() => groupAgendaTasks(filteredTasks), [filteredTasks]);
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
    // requestJson (lib/client-request.ts): se o servidor recusar (ex.: sem
    // permissão, reunião sem resultado), mostra o motivo em vez de a tela só
    // "desmarcar sozinha" no refresh.
    const res = await requestJson(`/api/tasks/${taskId}`, {
      method: "PUT",
      json:
        meetingOutcome === "RESCHEDULED"
          ? { meetingOutcome, dueAt: newDueAt }
          : { completed, ...(meetingOutcome ? { meetingOutcome } : {}) },
    });
    const data = res.data ?? {};
    if (res.ok && completed && meetingOutcome !== "RESCHEDULED") trackUse("agenda.atividade.concluir");
    router.refresh();
    pushUndoToast(data.undo);
  }

  async function deleteTask(taskId: string) {
    const res = await requestJson(`/api/tasks/${taskId}`, { method: "DELETE" });
    router.refresh();
    if (res.ok) pushUndoToast(res.data?.undo);
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

      {!isEmpty && (
        <AgendaSummary
          counts={{
            pending: summaryGroups.pending.length,
            overdue: summaryGroups.overdue.length,
            today: summaryGroups.today.length,
            upcoming: summaryGroups.upcoming.length,
            noDate: summaryGroups.noDate.length,
          }}
          active={focusFilter}
          onChange={(focus) => {
            setFocusFilter(focus);
            setStatusFilter("pending");
            if (focus !== "all") setView("list");
          }}
        />
      )}

      <div className="flex items-center gap-2 rounded-2xl border border-neutral-200 bg-white/60 p-2 dark:border-neutral-800 dark:bg-neutral-950/30">
        <div className="inline-flex min-w-0 flex-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-900">
          <button
            type="button"
            onClick={() => setView("list")}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors ${
              view === "list"
                ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
                : "text-neutral-500 dark:text-neutral-400"
            }`}
          >
            <List className="h-4 w-4" strokeWidth={2} />
            Lista
          </button>
          <button
            type="button"
            onClick={() => setView("calendar")}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors ${
              view === "calendar"
                ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
                : "text-neutral-500 dark:text-neutral-400"
            }`}
          >
            <CalendarDays className="h-4 w-4" strokeWidth={2} />
            Mês
          </button>
        </div>
        <button type="button" onClick={() => setOpen(true)} className="btn-primary px-3 py-2.5">
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          Nova
        </button>
      </div>

      {!isEmpty && (
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
              strokeWidth={2}
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar atividade ou contato"
              className="field-input py-2.5 pl-9 text-sm"
            />
          </div>
          <FilterPopover active={hasFilters} onClear={clearFilters}>
            <div className="space-y-2">
              <label className="field-label">Status</label>
              <div className="flex flex-wrap gap-1.5">
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
                    onClick={() => {
                      setStatusFilter(opt.value);
                      setFocusFilter("all");
                    }}
                    className={`rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors ${
                      statusFilter === opt.value
                        ? "border-neutral-900 bg-neutral-100 text-neutral-900 dark:border-white dark:bg-neutral-800 dark:text-white"
                        : "border-neutral-200 text-neutral-500 dark:border-neutral-800 dark:text-neutral-400"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <label className="field-label">Categoria</label>
              <div className="flex flex-wrap gap-1.5">
                {sortAlpha(Object.entries(TASK_TYPE_LABELS), ([, label]) => label).map(([value, label]) => {
                  const color = TASK_TYPE_COLOR[value];
                  const active = typeFilters.has(value);
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => toggleType(value)}
                      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors active:scale-[0.97] ${
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
                    ...sortAlpha(members, (m) => m.name).map((m) => ({ value: m.id, label: m.name })),
                  ]}
                />
              </div>
            )}
          </FilterPopover>
        </div>
      )}

      {isEmpty ? (
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800">
          <EmptyState
            icon={CheckSquare}
            title="Nenhuma atividade por aqui"
            description="Crie uma atividade para organizar o próximo contato."
          />
        </div>
      ) : view === "calendar" ? (
        <div className="space-y-4">
          <CompactMonthCalendar
            tasks={filteredTasks}
            onToggle={toggleComplete}
            onDelete={deleteTask}
            canDelete={canDelete}
            showOwner={showOwner}
            deals={deals}
            googleEvents={showGoogleEvents ? googleCalendar.events : []}
          />
          <UpcomingAppointmentsCard tasks={filteredTasks} onToggle={toggleComplete} onDelete={deleteTask} canDelete={canDelete} deals={deals} googleEvents={showGoogleEvents ? googleCalendar.events : []} />
        </div>
      ) : noResults ? (
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800">
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

      {taskDialogOpen && (
        <NewTaskDialog
          deals={deals}
          isWhatsAppConnected={isWhatsAppConnected}
          onClose={() => {
            setOpen(false);
            if (openNewTask) router.replace("/agenda");
          }}
          onCreated={() => {
            setOpen(false);
            if (openNewTask) router.replace("/agenda");
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
        className={`mb-3 text-base font-semibold ${
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
