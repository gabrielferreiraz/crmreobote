"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { Modal } from "./modal";
import { LoadingDots } from "./loading-dots";
import { DatePicker } from "./date-picker";
import { TimePicker } from "./time-picker";
import { MEETING_OUTCOME_OPTIONS } from "@/lib/activity-icons";

export type MeetingOutcomeResult =
  | { outcome: "ATTENDED" | "NO_SHOW" }
  | { outcome: "RESCHEDULED"; dueAt: string };

/**
 * Pergunta o resultado de uma Reunião/Visita na CONCLUSÃO da tarefa (não
 * mais na criação — ver ActivityMeetingOutcome no schema e o motivo dessa
 * mudança lá). Reaproveitado nos 3 pontos que concluem tarefa desse tipo
 * (negocios/[id]/deal-detail.tsx, agenda/task-row.tsx, agenda/task-detail-
 * modal.tsx) — antes cada tela tinha sua própria cópia do seletor
 * (deal-detail.tsx ainda tinha 2, desktop e mobile), esse componente único
 * substitui todas.
 *
 * Sem opção pré-selecionada de propósito (era o próprio problema que essa
 * mudança corrige — "Compareceu" marcado por padrão registrava
 * comparecimento antes do encontro acontecer) — precisa escolher pra
 * "Confirmar" habilitar. "Remarcou" abre um 2º passo pedindo a nova data —
 * essa tentativa é finalizada (fica registrado que o consultor foi atrás,
 * mesmo sem sucesso) e uma tarefa NOVA nasce pro próximo encontro, em vez de
 * só editar a data desta mesma tarefa; RESCHEDULED nunca entra como
 * "reunião realizada" nos Relatórios (ver PUT /api/tasks/[id] e
 * lib/reports/commercial-data.ts).
 */
export function MeetingOutcomeDialog({
  taskType,
  onResolve,
  onClose,
}: {
  taskType: "MEETING" | "VISIT";
  onResolve: (result: MeetingOutcomeResult) => Promise<void> | void;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState<"ATTENDED" | "NO_SHOW" | "RESCHEDULED" | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [loading, setLoading] = useState(false);
  const typeLabel = taskType === "MEETING" ? "reunião" : "visita";

  async function confirm() {
    if (!choice) return;
    setLoading(true);
    if (choice === "RESCHEDULED") {
      await onResolve({ outcome: "RESCHEDULED", dueAt: `${rescheduleDate}T${rescheduleTime || "00:00"}` });
    } else {
      await onResolve({ outcome: choice });
    }
    setLoading(false);
  }

  const canConfirm = choice === "ATTENDED" || choice === "NO_SHOW" || (choice === "RESCHEDULED" && !!rescheduleDate);

  return (
    <Modal onClose={onClose} maxWidth="max-w-sm">
      <div className="flex gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800">
          <CalendarClock className="h-5 w-5 text-neutral-600 dark:text-neutral-400" strokeWidth={2} />
        </div>
        <div className="mt-0.5 flex-1">
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            Como foi a {typeLabel}?
          </h2>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Precisa informar o resultado antes de concluir — isso alimenta a taxa de comparecimento nos Relatórios.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {MEETING_OUTCOME_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setChoice(opt.value)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              choice === opt.value
                ? opt.activeClass
                : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {choice === "RESCHEDULED" && (
        <div className="mt-4 flex gap-2">
          <div className="flex-1 space-y-1">
            <label className="field-label">Nova data</label>
            <DatePicker value={rescheduleDate} onChange={setRescheduleDate} className="w-full" />
          </div>
          <div className="space-y-1">
            <label className="field-label">Horário</label>
            <TimePicker value={rescheduleTime} onChange={setRescheduleTime} disabled={!rescheduleDate} />
          </div>
        </div>
      )}

      <div className="mt-6 flex justify-end gap-3">
        <button type="button" onClick={onClose} className="btn-secondary">
          Cancelar
        </button>
        <button type="button" onClick={confirm} disabled={!canConfirm || loading} className="btn-primary">
          {loading ? (
            <span className="inline-flex items-center gap-1">
              Salvando
              <LoadingDots />
            </span>
          ) : (
            "Confirmar"
          )}
        </button>
      </div>
    </Modal>
  );
}
