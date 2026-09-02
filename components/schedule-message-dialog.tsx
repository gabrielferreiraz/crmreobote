"use client";

import { useState } from "react";
import { Loader2, MessageCircle, ChevronLeft } from "lucide-react";
import { Modal } from "./modal";
import { AnimatedCheck } from "./animated-check";
import { PhoneMock, MessageBubblePreview, AnimatedPhonePreview } from "./task-message-phone-preview";
import { renderTemplate } from "@/lib/campaigns/spintax";
import { brazilGreeting } from "@/lib/timezone";

export type ScheduleMessageTask = {
  id: string;
  title: string;
  dueAt: string | Date;
  contact: {
    id: string;
    name: string;
    jobTitle?: string | null;
    company?: string | null;
    city?: string | null;
    phone: string | null;
    whatsapp: string | null;
  };
};

// Mesmo motivo de meeting-invite-dialog.tsx: força o horário local da
// operação (Campo Grande/MS) explicitamente, senão usa o fuso do NAVEGADOR
// de quem está vendo a tela.
function formatDateTime(d: Date): string {
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Campo_Grande",
  });
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/**
 * Abre logo depois de criar uma tarefa WHATSAPP com prazo futuro e contato
 * vinculado (ver NewTaskDialog em app/(dashboard)/agenda/tasks-list.tsx e
 * submitActivity em app/(dashboard)/negocios/[id]/deal-detail.tsx) — deixa
 * escrever a mensagem que vai sair SOZINHA pro WhatsApp do contato, no
 * exato prazo da tarefa. Diferente do MeetingInviteDialog (que manda na
 * hora ao clicar), este só SALVA o texto — quem manda de verdade, no
 * momento certo, é o cron (lib/tasks/scheduled-whatsapp.ts).
 */
export function ScheduleMessageDialog({
  task,
  onClose,
}: {
  task: ScheduleMessageTask;
  onClose: () => void;
}) {
  const [step, setStep] = useState<"prompt" | "compose" | "saved">("prompt");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dueAt = new Date(task.dueAt);
  const hasClientNumber = !!(task.contact.whatsapp || task.contact.phone);

  const previewText = renderTemplate(
    message.trim() || "…",
    { nome: task.contact.name, cargo: task.contact.jobTitle, empresa: task.contact.company, cidade: task.contact.city },
    brazilGreeting(),
  );

  async function handleSave() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/tasks/${task.id}/schedule-message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao programar mensagem");
      return;
    }
    setStep("saved");
    setTimeout(onClose, 1700);
  }

  return (
    <Modal onClose={onClose} maxWidth="max-w-md">
      {step === "prompt" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Tarefa de WhatsApp criada</h2>
            <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
              {task.contact.name} · {formatDateTime(dueAt)}
            </p>
          </div>

          <AnimatedPhonePreview text={previewText} />

          {!hasClientNumber && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-center text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
              Esse cliente não tem WhatsApp/celular cadastrado — a mensagem programada pode não sair na hora certa.
            </p>
          )}

          <p className="text-center text-sm font-medium text-neutral-800 dark:text-neutral-200">
            Quer programar uma mensagem pra sair automaticamente nesse horário?
          </p>

          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => setStep("compose")} className="btn-primary w-full justify-center">
              <MessageCircle className="h-4 w-4" strokeWidth={2} />
              Programar mensagem
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
              onClick={() => setStep("prompt")}
              className="icon-btn -ml-1 shrink-0 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
              aria-label="Voltar"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={2} />
            </button>
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Programar mensagem</h2>
          </div>

          <PhoneMock>
            <MessageBubblePreview text={previewText} />
          </PhoneMock>

          <div className="space-y-1">
            <textarea
              autoFocus
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={`O que enviar para ${firstName(task.contact.name)}?`}
              rows={5}
              className="field-input text-sm"
            />
            <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
              Variáveis: {"{nome} {primeiro_nome} {cargo} {empresa} {cidade} {saudacao}"}
            </p>
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <button type="button" onClick={handleSave} disabled={saving || !message.trim()} className="btn-primary w-full justify-center">
            {saving && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      )}

      {step === "saved" && (
        <div className="animate-step-slide-in flex flex-col items-center gap-3 py-6 text-center">
          <AnimatedCheck className="h-10 w-10 text-emerald-500" justDrawn />
          <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
            Mensagem programada! Vai sair pro WhatsApp de {task.contact.name} dia{" "}
            {dueAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Campo_Grande" })} às{" "}
            {dueAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Campo_Grande" })}.
          </p>
        </div>
      )}
    </Modal>
  );
}
