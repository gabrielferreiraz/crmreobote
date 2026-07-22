"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, CheckSquare, Loader2, List, CalendarDays, Search, SearchX } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Modal } from "@/components/modal";
import { FilterPopover } from "@/components/filter-popover";
import { ContactSearchInput } from "@/components/contact-search-input";
import { MeetingInviteDialog, type MeetingInviteTask } from "@/components/meeting-invite-dialog";
import { VoiceInputButton, appendDictatedText } from "@/components/voice-input-button";
import { LoadingDots } from "@/components/loading-dots";
import { Select } from "@/components/select";
import { TASK_TYPE_LABELS, TASK_TYPE_COLOR } from "@/lib/task-icons";
import { TaskRow, type Task } from "./task-row";
import { TaskCalendar, type GoogleEvent } from "./task-calendar";
import { GoogleCalendarBanner } from "./google-calendar-banner";
import { UpcomingAppointmentsCard } from "./upcoming-appointments-card";

export type Option = { id: string; name: string };

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

export function TasksList({
  initialTasks,
  deals,
  members,
  googleEvents,
  isGoogleConnected,
  isWhatsAppConnected,
  googleParam,
}: {
  initialTasks: Task[];
  deals: Option[];
  members: Option[];
  googleEvents?: GoogleEvent[];
  isGoogleConnected: boolean;
  isWhatsAppConnected: boolean;
  googleParam?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"list" | "calendar">("calendar");
  const [search, setSearch] = useState("");
  const [typeFilters, setTypeFilters] = useState<Set<string>>(new Set());
  const [ownerFilter, setOwnerFilter] = useState("");
  const showOwner = members.length > 1;

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
    <div className="space-y-6">
      <GoogleCalendarBanner isGoogleConnected={isGoogleConnected} googleParam={googleParam} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_300px] xl:items-start">
      <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-800 p-0.5">
          <button
            onClick={() => setView("calendar")}
            className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              view === "calendar"
                ? "bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 shadow-sm"
                : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
            }`}
          >
            <CalendarDays className="h-3.5 w-3.5" strokeWidth={2} />
            Mês
          </button>
          <button
            onClick={() => setView("list")}
            className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              view === "list"
                ? "bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 shadow-sm"
                : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
            }`}
          >
            <List className="h-3.5 w-3.5" strokeWidth={2} />
            Lista
          </button>
        </div>

        <button onClick={() => setOpen(true)} className="btn-primary">
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          Nova atividade
        </button>
      </div>

      {!isEmpty && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
              strokeWidth={2}
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar tarefa, negócio ou contato"
              className="field-input w-64 py-1.5 pl-8 text-sm"
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
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium transition-colors ${
                        active
                          ? "border-neutral-900 dark:border-white"
                          : "border-transparent hover:border-neutral-200 dark:hover:border-neutral-700"
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
            description="Crie atividades para organizar ligações, e-mails e follow-ups."
          />
        </div>
      ) : view === "calendar" ? (
        <TaskCalendar tasks={filteredTasks} onToggle={toggleComplete} showOwner={showOwner} googleEvents={googleEvents} />
      ) : noResults ? (
        <div className="card">
          <EmptyState
            icon={SearchX}
            title="Nenhuma atividade encontrada"
            description="Ajuste a busca ou limpe os filtros."
          />
        </div>
      ) : (
        <div className="space-y-6">
          <TaskGroup title="Atrasadas" tasks={groups.overdue} tone="red" onToggle={toggleComplete} showOwner={showOwner} />
          <TaskGroup title="Hoje" tasks={groups.today} onToggle={toggleComplete} showOwner={showOwner} />
          <TaskGroup title="Próximas" tasks={groups.upcoming} onToggle={toggleComplete} showOwner={showOwner} />
          <TaskGroup title="Sem prazo" tasks={groups.noDate} onToggle={toggleComplete} showOwner={showOwner} />
          <TaskGroup title="Concluídas (últimos 30 dias)" tasks={groups.completed} onToggle={toggleComplete} muted showOwner={showOwner} />
        </div>
      )}
      </div>

      <div className="xl:sticky xl:top-4">
        <UpcomingAppointmentsCard tasks={initialTasks} onToggle={toggleComplete} />
      </div>
      </div>

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

function TaskGroup({
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

export function NewTaskDialog({
  deals,
  isWhatsAppConnected,
  onClose,
  onCreated,
}: {
  deals: Option[];
  /** Sem isso, o passo de convite (ver meetingInviteTask abaixo) nem oferece a opção de enviar. */
  isWhatsAppConnected?: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState("CALL");
  const [dueAt, setDueAt] = useState("");
  const [description, setDescription] = useState("");
  const [contactId, setContactId] = useState("");
  const [dealId, setDealId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Setado só quando a tarefa recém-criada é uma Reunião com data e cliente
  // vinculado — troca o formulário pelo MeetingInviteDialog em vez de fechar
  // na hora (ver render abaixo).
  const [meetingInviteTask, setMeetingInviteTask] = useState<MeetingInviteTask | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        type,
        description: description || undefined,
        dueAt: dueAt || undefined,
        contactId: contactId || undefined,
        dealId: dealId || undefined,
      }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao criar atividade");
      return;
    }

    const created = await res.json();
    if (created.type === "MEETING" && created.dueAt && created.contact) {
      setMeetingInviteTask({
        id: created.id,
        title: created.title,
        dueAt: created.dueAt,
        contact: { id: created.contact.id, name: created.contact.name, phone: created.contact.phone, whatsapp: created.contact.whatsapp },
        owner: { name: created.owner.name },
      });
      return;
    }

    onCreated();
  }

  if (meetingInviteTask) {
    return (
      <MeetingInviteDialog
        task={meetingInviteTask}
        isWhatsAppConnected={!!isWhatsAppConnected}
        onClose={onCreated}
      />
    );
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Nova atividade</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <label className="field-label">Título</label>
            <VoiceInputButton onResult={(text) => setTitle((prev) => appendDictatedText(prev, text))} />
          </div>
          <input
            autoFocus
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="field-input"
          />
        </div>
        <div className="space-y-1">
          <label className="field-label">Tipo</label>
          <Select
            value={type}
            onChange={setType}
            options={Object.entries(TASK_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </div>
        <div className="space-y-1">
          <label className="field-label">Prazo</label>
          <input
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="field-input"
          />
        </div>
        <div className="space-y-1">
          <label className="field-label">Negócio (opcional)</label>
          <Select
            value={dealId}
            onChange={setDealId}
            options={[{ value: "", label: "—" }, ...deals.map((d) => ({ value: d.id, label: d.name }))]}
          />
        </div>
        <div className="space-y-1">
          <label className="field-label">Contato (opcional)</label>
          <ContactSearchInput value={contactId} onChange={(id) => setContactId(id)} />
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <label className="field-label">Descrição</label>
            <VoiceInputButton onResult={(text) => setDescription((prev) => appendDictatedText(prev, text))} />
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="field-input"
          />
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button type="submit" disabled={loading || !title.trim()} className="btn-primary">
            {loading && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
            {loading ? (
              <span className="inline-flex items-center gap-1">
                Criando
                <LoadingDots />
              </span>
            ) : (
              "Criar"
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
