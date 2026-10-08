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
 * Pergunta o resultado de uma Videochamada/Visita na CONCLUSÃO da tarefa (não
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
 * "videochamada realizada" nos Relatórios (ver PUT /api/tasks/[id] e
 * lib/reports/commercial-data.ts).
 */
export function MeetingOutcomeDialog({
  taskType,
  onResolve,
  onClose,
}: {
  taskType: "VIDEO_CALL" | "VISIT";
  onResolve: (result: MeetingOutcomeResult) => Promise<void> | void;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState<"ATTENDED" | "NO_SHOW" | "RESCHEDULED" | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [loading, setLoading] = useState(false);
  const typeLabel = taskType === "VIDEO_CALL" ? "videochamada" : "visita";

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
    <Modal onClose={onClose} maxWidth="max-w-md" mobileSheet>
      <div className="flex items-start gap-3 lg:hidden">
        <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-brand" strokeWidth={2} />
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            Como foi a {typeLabel}?
          </h2>
          <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            Selecione o resultado para concluir.
          </p>
        </div>
      </div>

      <div className="hidden gap-4 lg:flex">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800">
          <CalendarClock className="h-5 w-5 text-neutral-600 dark:text-neutral-400" strokeWidth={2} />
        </div>
        <div className="mt-0.5 flex-1">
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            Como foi a {typeLabel}?
          </h2>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Informe o resultado.
          </p>
        </div>
      </div>

      <div className="mt-5 divide-y divide-neutral-200 overflow-hidden rounded-md border border-neutral-200 dark:divide-white/[0.08] dark:border-white/10 lg:hidden">
        {MEETING_OUTCOME_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const isSelected = choice === opt.value;
          return (
            <label
              key={opt.value}
              className={`flex min-h-14 cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors ${
                isSelected
                  ? "bg-neutral-100/80 text-neutral-950 dark:bg-white/[0.06] dark:text-white"
                  : "bg-transparent text-neutral-700 active:bg-neutral-50 dark:text-neutral-300 dark:active:bg-white/[0.04]"
              }`}
            >
              <Icon
                className={`h-5 w-5 shrink-0 ${isSelected ? opt.iconSelectedClass : "text-neutral-400 dark:text-neutral-500"}`}
                strokeWidth={2}
              />
              <span className="min-w-0 flex-1 text-sm font-medium">{opt.label}</span>
              <input
                type="radio"
                name="meeting-outcome"
                value={opt.value}
                checked={isSelected}
                onChange={() => setChoice(opt.value)}
                className="h-4 w-4 shrink-0 accent-brand"
              />
            </label>
          );
        })}
      </div>

      <div className="mt-5 hidden grid-cols-3 gap-2.5 lg:grid">
        {MEETING_OUTCOME_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const isSelected = choice === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setChoice(opt.value)}
              className={`flex flex-col items-center justify-center gap-2 rounded-xl border p-3 text-center transition-all ${isSelected
                ? opt.cardSelectedClass
                : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300 hover:bg-neutral-100/60 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-300 dark:hover:border-neutral-700 dark:hover:bg-neutral-800"
                }`}
            >
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${isSelected
                  ? opt.value === "ATTENDED"
                    ? "bg-emerald-100 dark:bg-emerald-900/60"
                    : opt.value === "NO_SHOW"
                      ? "bg-rose-100 dark:bg-rose-900/60"
                      : "bg-amber-100 dark:bg-amber-900/60"
                  : "bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500"
                  }`}
              >
                <Icon className={`h-5 w-5 ${isSelected ? opt.iconSelectedClass : ""}`} strokeWidth={2.2} />
              </div>
              <span className="text-xs font-semibold leading-snug">{opt.label}</span>
            </button>
          );
        })}
      </div>

      {choice === "RESCHEDULED" && (
        <div className="mt-4 grid grid-cols-[minmax(0,1fr)_7rem] gap-2 border-t border-neutral-200 pt-4 dark:border-white/10 lg:flex lg:border-0 lg:pt-0">
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

      <div className="mt-5 flex flex-col gap-2 lg:hidden">
        <button type="button" onClick={confirm} disabled={!canConfirm || loading} className="btn-primary min-h-12 w-full">
          {loading ? (
            <span className="inline-flex items-center gap-1">
              Salvando
              <LoadingDots />
            </span>
          ) : (
            "Confirmar resultado"
          )}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 w-full text-sm font-medium text-neutral-500 transition-colors active:text-neutral-900 dark:text-neutral-400 dark:active:text-neutral-100"
        >
          Cancelar
        </button>
      </div>

      <div className="mt-6 hidden justify-end gap-3 lg:flex">
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
