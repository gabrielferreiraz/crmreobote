"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  MessageCircle,
  ChevronLeft,
  ChevronRight,
  X,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Modal } from "./modal";
import { AnimatedCheck } from "./animated-check";
import {
  PhoneMock,
  MessageBubblePreview,
  AnimatedPhonePreview,
} from "./task-message-phone-preview";
import { renderTemplate } from "@/lib/campaigns/spintax";
import { brazilGreeting } from "@/lib/timezone";
import { ConfirmDialog } from "./confirm-dialog";

export type BulkScheduleTask = {
  id: string;
  title: string;
  dueAt: string | Date;
  contact: {
    id: string;
    name: string;
    jobTitle?: string | null;
    company?: string | null;
    city?: string | null;
    whatsapp?: string | null;
    phone?: string | null;
  };
};

const DEFAULT_TEMPLATE = `{saudacao} {primeiro_nome}, tudo bem? Passando pra lembrar do nosso papo sobre consórcio. {{consultor.nome}} vai te mandar mais detalhes em instantes.`;

function formatDate(d: Date): string {
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Campo_Grande",
  });
}

export function BulkScheduleTasksDialog({
  tasks,
  onClose,
}: {
  tasks: BulkScheduleTask[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<"intro" | "compose" | "saved">("intro");
  const [message, setMessage] = useState(DEFAULT_TEMPLATE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ saved: number; skipped: number } | null>(null);
  const [confirmTooMany, setConfirmTooMany] = useState(false);

  // Faz uma prévia da mensagem usando a primeira tarefa.
  const previewTask = tasks[0];

  const validTasks = useMemo(() => {
    const now = new Date();
    return tasks.filter((t) => {
      if (!t.contact) return false;
      const hasNumber = !!t.contact.whatsapp || !!t.contact.phone;
      const futureDue = !!t.dueAt && new Date(t.dueAt) > now;
      return hasNumber && futureDue;
    });
  }, [tasks]);

  const missingNumbers = tasks.filter(
    (t) => t.contact && !(t.contact.whatsapp || t.contact.phone),
  );

  const previewText = previewTask
    ? renderTemplate(
        message.trim() || "…",
        {
          nome: previewTask.contact.name,
          cargo: previewTask.contact.jobTitle,
          empresa: previewTask.contact.company,
          cidade: previewTask.contact.city,
        },
        brazilGreeting(),
      )
    : "…";

  async function handleSave(force = false) {
    if (!force && validTasks.length > 50) {
      setConfirmTooMany(true);
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/tasks/bulk-schedule-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskIds: validTasks.map((t) => t.id),
        message,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? "Erro ao agendar mensagens");
      return;
    }
    setResult(data as { saved: number; skipped: number });
    setStep("saved");
    router.refresh();
    setTimeout(onClose, 2200);
  }

  return (
    <>
      <Modal onClose={onClose} maxWidth="max-w-lg">
        {step === "intro" && (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                Agendar mensagens automáticas
              </h2>
              <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
                {tasks.length} tarefa{tasks.length === 1 ? "" : "s"} de WhatsApp selecionada
                {tasks.length === 1 ? "" : "s"}.
              </p>
            </div>

            <AnimatedPhonePreview text={previewText} />

            <div className="space-y-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
              <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                Resumo da seleção
              </p>
              <ul className="space-y-1 text-xs text-neutral-500 dark:text-neutral-400">
                <li>
                  • {validTasks.length} pronta{validTasks.length === 1 ? "" : "s"} para agendar
                  (tem WhatsApp e prazo futuro)
                </li>
                {missingNumbers.length > 0 && (
                  <li className="flex items-start gap-1 text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={2.5} />
                    <span>
                      {missingNumbers.length} sem WhatsApp/celular cadastrado — serão puladas
                    </span>
                  </li>
                )}
                {tasks.length - validTasks.length - missingNumbers.length > 0 && (
                  <li>
                    • {tasks.length - validTasks.length - missingNumbers.length} com prazo já
                    passado (puladas)
                  </li>
                )}
              </ul>
            </div>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setStep("compose")}
                disabled={validTasks.length === 0}
                className="btn-primary w-full justify-center"
              >
                <MessageCircle className="h-4 w-4" strokeWidth={2} />
                Escrever mensagem
              </button>
              <button
                type="button"
                onClick={onClose}
                className="text-center text-xs text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
              >
                Agora não
              </button>
            </div>
          </div>
        )}

        {step === "compose" && (
          <div className="animate-step-slide-in space-y-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setStep("intro")}
                className="icon-btn -ml-1 shrink-0 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                aria-label="Voltar"
              >
                <ChevronLeft className="h-4 w-4" strokeWidth={2} />
              </button>
              <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                Escreva a mensagem
              </h2>
            </div>

            <PhoneMock>
              <MessageBubblePreview text={previewText} />
            </PhoneMock>

            <div className="space-y-1">
              <textarea
                autoFocus
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Mensagem para todos os contatos selecionados…"
                rows={5}
                className="field-input text-sm"
              />
              <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
                Variáveis: {`{nome} {primeiro_nome} {cargo} {empresa} {cidade} {saudacao}`}
              </p>
            </div>

            <div className="scrollbar-thin max-h-32 space-y-1 overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-800">
              {validTasks.slice(0, 10).map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs"
                >
                  <span className="truncate text-neutral-700 dark:text-neutral-300">
                    {t.contact.name}
                  </span>
                  <span className="shrink-0 text-neutral-400 dark:text-neutral-500">
                    {formatDate(new Date(t.dueAt))}
                  </span>
                </div>
              ))}
              {validTasks.length > 10 && (
                <div className="px-2.5 py-1.5 text-[11px] text-neutral-400 dark:text-neutral-500">
                  +{validTasks.length - 10} mais…
                </div>
              )}
            </div>

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={() => setStep("intro")} className="btn-ghost">
                Voltar
              </button>
              <button
                type="button"
                onClick={() => handleSave(false)}
                disabled={saving || !message.trim() || validTasks.length === 0}
                className="btn-primary"
              >
                {saving ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
                    Salvando…
                  </span>
                ) : (
                  <>
                    Salvar
                    <ChevronRight className="h-4 w-4 -mr-1" strokeWidth={2} />
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {step === "saved" && result && (
          <div className="animate-step-slide-in flex flex-col items-center gap-3 py-6 text-center">
            <AnimatedCheck className="h-10 w-10 text-emerald-500" justDrawn />
            <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
              {result.saved} mensagem{result.saved === 1 ? "" : "s"} agendada
              {result.saved === 1 ? "" : "s"}!
              {result.skipped > 0 && (
                <> <span className="text-neutral-500">({result.skipped} pulada{result.skipped === 1 ? "" : "s"})</span></>
              )}
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Cada mensagem sairá automaticamente no horário da respectiva tarefa.
            </p>
          </div>
        )}
      </Modal>

      {confirmTooMany && (
        <ConfirmDialog
          title={`Agendar ${validTasks.length} mensagens?`}
          description="Um volume muito grande de mensagens programadas no mesmo horário pode ser detectado como spam pelo WhatsApp se você usar número conectado via QR Code. Se for API oficial da Meta é seguro. Deseja continuar?"
          confirmLabel="Continuar mesmo assim"
          onClose={() => setConfirmTooMany(false)}
          onConfirm={async () => {
            setConfirmTooMany(false);
            await handleSave(true);
          }}
        />
      )}
    </>
  );
}
