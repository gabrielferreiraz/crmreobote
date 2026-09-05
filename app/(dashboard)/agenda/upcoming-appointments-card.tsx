"use client";

import { useMemo, useState } from "react";
import { CalendarClock, Calendar as CalendarIcon } from "lucide-react";
import { TaskDetailModal } from "./task-detail-modal";
import { GoogleEventDetailModal } from "./google-event-detail-modal";
import type { Task } from "./task-row";
import type { GoogleEvent } from "./task-calendar";
import { useMeetingOutcomeGate } from "./use-meeting-outcome-gate";
import type { Option } from "./tasks-list";

const MONTH_ABBR = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

function formatWhen(date: Date): string {
  const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const day = String(date.getDate()).padStart(2, "0");
  return `${time} (${day} ${MONTH_ABBR[date.getMonth()]})`;
}

/**
 * Os 5 compromissos com prazo mais próximo (nunca já concluídos nem já
 * vencidos) — um "de olho no que vem primeiro" sem precisar abrir o mês
 * inteiro do calendário ou rolar pelos grupos "Hoje"/"Próximas". Clique abre
 * o mesmo TaskDetailModal usado no resto da Agenda.
 */
type UpcomingItem =
  | { kind: "task"; date: Date; task: Task & { dueAt: string | Date } }
  | { kind: "google"; date: Date; event: GoogleEvent };

export function UpcomingAppointmentsCard({
  tasks,
  onToggle,
  onDelete,
  canDelete,
  deals,
  googleEvents = [],
}: {
  tasks: Task[];
  onToggle: (id: string, completed: boolean, meetingOutcome?: "ATTENDED" | "NO_SHOW" | "RESCHEDULED", newDueAt?: string) => void;
  onDelete?: (id: string) => Promise<void> | void;
  /** Qualquer papel com acesso à tarefa pode excluir — ver TaskDetailModal. */
  canDelete?: boolean;
  /** Repassado pro TaskDetailModal — habilita o botão "Editar" (ver EditTaskDialog). */
  deals?: Option[];
  /** Eventos do Google Agenda (mesma fonte da grade do mês, ver
   * task-calendar.tsx) — entram misturados com as tarefas, ordenados só
   * pela data. Sem filtro de consultor/categoria aqui (diferente da grade):
   * este card já ignora os filtros da lista abaixo dele de propósito (mostra
   * sempre os PRÓXIMOS compromissos de verdade, ver comentário da função),
   * então não tem "filtro ativo" nenhum que faria sentido escondê-los. */
  googleEvents?: GoogleEvent[];
}) {
  const [openItem, setOpenItem] = useState<UpcomingItem | null>(null);
  // Abre TaskDetailModal por FORA do TaskRow (cartão próprio de "próximos
  // compromissos") — mesma trava de use-meeting-outcome-gate.tsx, senão
  // concluir uma Reunião/Visita por aqui pula a pergunta de resultado.
  const { requestComplete, dialog: outcomeDialog } = useMeetingOutcomeGate(onToggle);

  const upcoming = useMemo(() => {
    const now = new Date();
    const upcomingTasks: UpcomingItem[] = tasks
      .filter((t): t is Task & { dueAt: string | Date } => !t.completedAt && !!t.dueAt && new Date(t.dueAt) >= now)
      .map((task) => ({ kind: "task" as const, date: new Date(task.dueAt), task }));
    const upcomingGoogle: UpcomingItem[] = googleEvents
      .filter((e) => new Date(e.start) >= now)
      .map((event) => ({ kind: "google" as const, date: new Date(event.start), event }));

    return [...upcomingTasks, ...upcomingGoogle].sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, 5);
  }, [tasks, googleEvents]);

  if (upcoming.length === 0) return null;

  const openTask = openItem?.kind === "task" ? openItem.task : null;
  const openGoogleEvent = openItem?.kind === "google" ? openItem.event : null;

  return (
    <>
      <div className="card p-4">
        <div className="mb-3 flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Compromissos agendados</h2>
        </div>
        <div className="space-y-3">
          {upcoming.map((item) =>
            item.kind === "task" ? (
              <button
                key={item.task.id}
                type="button"
                onClick={() => setOpenItem(item)}
                className="block w-full border-l-2 border-neutral-900 pl-3 text-left transition-opacity hover:opacity-70 dark:border-white"
              >
                <p className="line-clamp-2 text-sm font-medium text-neutral-900 dark:text-neutral-100">{item.task.title}</p>
                <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
                  {[item.task.contact?.name ?? item.task.deal?.name, formatWhen(item.date)].filter(Boolean).join(" · ")}
                </p>
              </button>
            ) : (
              <button
                key={item.event.id}
                type="button"
                onClick={() => setOpenItem(item)}
                className="block w-full border-l-2 border-blue-500 pl-3 text-left transition-opacity hover:opacity-70"
              >
                <p className="line-clamp-2 flex items-center gap-1.5 text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  <CalendarIcon className="h-3 w-3 shrink-0 text-blue-500" strokeWidth={2} />
                  {item.event.title}
                </p>
                <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
                  Google Agenda · {formatWhen(item.date)}
                </p>
              </button>
            ),
          )}
        </div>
      </div>

      {openTask && (
        <TaskDetailModal
          task={openTask}
          completed={false}
          justCompleted={false}
          onClose={() => setOpenItem(null)}
          onToggle={() => {
            if (requestComplete(openTask)) {
              setOpenItem(null);
              return;
            }
            onToggle(openTask.id, true);
            setOpenItem(null);
          }}
          canDelete={canDelete}
          onDelete={onDelete}
          deals={deals}
        />
      )}
      {openGoogleEvent && <GoogleEventDetailModal event={openGoogleEvent} onClose={() => setOpenItem(null)} />}
      {outcomeDialog}
    </>
  );
}
