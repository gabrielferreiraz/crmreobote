"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { TaskDetailModal } from "./task-detail-modal";
import type { Task } from "./task-row";
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
export function UpcomingAppointmentsCard({
  tasks,
  onToggle,
  onDelete,
  canDelete,
  deals,
}: {
  tasks: Task[];
  onToggle: (id: string, completed: boolean, meetingOutcome?: "ATTENDED" | "NO_SHOW" | "RESCHEDULED", newDueAt?: string) => void;
  onDelete?: (id: string) => Promise<void> | void;
  /** Qualquer papel com acesso à tarefa pode excluir — ver TaskDetailModal. */
  canDelete?: boolean;
  /** Repassado pro TaskDetailModal — habilita o botão "Editar" (ver EditTaskDialog). */
  deals?: Option[];
}) {
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  // Abre TaskDetailModal por FORA do TaskRow (cartão próprio de "próximos
  // compromissos") — mesma trava de use-meeting-outcome-gate.tsx, senão
  // concluir uma Reunião/Visita por aqui pula a pergunta de resultado.
  const { requestComplete, dialog: outcomeDialog } = useMeetingOutcomeGate(onToggle);

  const upcoming = tasks
    .filter((t): t is Task & { dueAt: string | Date } => !t.completedAt && !!t.dueAt && new Date(t.dueAt) >= new Date())
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
    .slice(0, 5);

  if (upcoming.length === 0) return null;

  const openTask = openTaskId ? upcoming.find((t) => t.id === openTaskId) ?? null : null;

  return (
    <>
      <div className="card p-4">
        <div className="mb-3 flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Compromissos agendados</h2>
        </div>
        <div className="space-y-3">
          {upcoming.map((task) => (
            <button
              key={task.id}
              type="button"
              onClick={() => setOpenTaskId(task.id)}
              className="block w-full border-l-2 border-neutral-900 pl-3 text-left transition-opacity hover:opacity-70 dark:border-white"
            >
              <p className="line-clamp-2 text-sm font-medium text-neutral-900 dark:text-neutral-100">{task.title}</p>
              <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
                {[task.contact?.name ?? task.deal?.name, formatWhen(new Date(task.dueAt))].filter(Boolean).join(" · ")}
              </p>
            </button>
          ))}
        </div>
      </div>

      {openTask && (
        <TaskDetailModal
          task={openTask}
          completed={false}
          justCompleted={false}
          onClose={() => setOpenTaskId(null)}
          onToggle={() => {
            if (requestComplete(openTask)) {
              setOpenTaskId(null);
              return;
            }
            onToggle(openTask.id, true);
            setOpenTaskId(null);
          }}
          canDelete={canDelete}
          onDelete={onDelete}
          deals={deals}
        />
      )}
      {outcomeDialog}
    </>
  );
}
