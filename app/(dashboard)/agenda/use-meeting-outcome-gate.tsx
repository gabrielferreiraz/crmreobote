"use client";

import { useState } from "react";
import { MeetingOutcomeDialog, type MeetingOutcomeResult } from "@/components/meeting-outcome-dialog";
import type { Task } from "./task-row";

/**
 * Intercepta a conclusão de uma Task MEETING/VISIT pra perguntar o
 * resultado antes (ver ActivityMeetingOutcome no schema e
 * meeting-outcome-dialog.tsx) — reaproveitado nos 2 pontos da Agenda que
 * concluem tarefa: TaskRow.handleToggle (checkbox da lista + botão
 * "Concluir" do TaskDetailModal, que já passa por ali) e o "selectedTask"
 * de TaskCalendar (visão de mês, abre TaskDetailModal por FORA do TaskRow,
 * sem passar pela interceptação de lá — precisava da mesma trava).
 */
export function useMeetingOutcomeGate(
  onToggle: (id: string, completed: boolean, meetingOutcome?: "ATTENDED" | "NO_SHOW" | "RESCHEDULED", newDueAt?: string) => void,
) {
  const [pending, setPending] = useState<Task | null>(null);

  /** Chamar antes de concluir — se devolver true, a conclusão foi
   * interceptada (dialog aberto) e quem chamou NÃO deve seguir com o toggle
   * normal. Desmarcar (completed→false) nunca passa por aqui. */
  function requestComplete(task: Task): boolean {
    if (task.type !== "MEETING" && task.type !== "VISIT") return false;
    setPending(task);
    return true;
  }

  async function resolve(result: MeetingOutcomeResult) {
    if (!pending) return;
    const taskId = pending.id;
    setPending(null);
    if (result.outcome === "RESCHEDULED") {
      onToggle(taskId, false, result.outcome, result.dueAt);
    } else {
      onToggle(taskId, true, result.outcome);
    }
  }

  const dialog = pending ? (
    <MeetingOutcomeDialog
      taskType={pending.type === "VISIT" ? "VISIT" : "MEETING"}
      onResolve={resolve}
      onClose={() => setPending(null)}
    />
  ) : null;

  return { requestComplete, dialog };
}
