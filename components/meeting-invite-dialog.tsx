"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarPlus, Loader2, MessageCircle, Send, ChevronLeft, Video, Copy, Check, Bell } from "lucide-react";
import { Modal } from "./modal";
import { AnimatedCheck } from "./animated-check";
import { Select } from "./select";
import { PhoneMock, MessageBubblePreview, AnimatedPhonePreview } from "./task-message-phone-preview";
import { buildGoogleCalendarUrl } from "@/lib/google-calendar";
import {
  DEFAULT_MEETING_INVITE_TEMPLATE,
  MEETING_INVITE_VARIABLES,
  renderMeetingInviteMessage,
  buildMeetingInviteVariables,
} from "@/lib/meeting-invite";

export type MeetingInviteTask = {
  id: string;
  title: string;
  dueAt: string | Date;
  contact: { id: string; name: string; phone: string | null; whatsapp: string | null };
  owner: { id: string; name: string };
  /** Responsável tem GoogleCalendarConnection com permissão de escrita — condição pra oferecer "Criar link do Google Meet". */
  ownerHasGoogleCalendarWriteAccess: boolean;
};

type MessageScriptOption = { id: string; name: string; steps: { text: string; delayAfterSec: number }[] };

// Presets comuns — "outro" cobre qualquer coisa fora disso via input numérico.
const REMINDER_MINUTES_PRESETS = [
  { value: "10", label: "10 minutos antes" },
  { value: "15", label: "15 minutos antes" },
  { value: "30", label: "30 minutos antes" },
  { value: "60", label: "1 hora antes" },
  { value: "120", label: "2 horas antes" },
  { value: "1440", label: "1 dia antes" },
];

// Mesmas variáveis de lib/campaigns/spintax.ts (renderTemplate) — chips
// clicáveis que inserem no cursor, em vez de só um texto de dica pra
// decorar/digitar na mão (pedido explícito: "no estilo do N8N", pra quem
// não é de tecnologia).
const REMINDER_VARIABLES = [
  { token: "{primeiro_nome}", label: "Primeiro nome" },
  { token: "{nome}", label: "Nome completo" },
  { token: "{cargo}", label: "Cargo" },
  { token: "{empresa}", label: "Empresa" },
  { token: "{cidade}", label: "Cidade" },
  { token: "{consultor}", label: "Seu nome" },
  { token: "{saudacao}", label: "Bom dia/tarde/noite" },
] as const;

// Força o horário local da operação (Campo Grande/MS) explicitamente — sem
// isso, usa o fuso do NAVEGADOR de quem está vendo a tela, que só bate com
// o fuso certo por coincidência. A variável {hora} do próprio template
// (buildMeetingInviteVariables, lib/meeting-invite.ts) já força
// America/Campo_Grande; sem forçar aqui também, o cabeçalho deste diálogo
// podia mostrar um horário diferente do que vai na mensagem de verdade.
function formatDateTime(d: Date): string {
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Campo_Grande",
  });
}

export function MeetingInviteDialog({
  task,
  isWhatsAppConnected,
  onClose,
}: {
  task: MeetingInviteTask;
  isWhatsAppConnected: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState<"prompt" | "compose" | "sent" | "reminder-setup" | "reminder-saved">("prompt");
  const [template, setTemplate] = useState(DEFAULT_MEETING_INVITE_TEMPLATE);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Google Meet — ação inline dentro do "prompt", não um passo à parte.
  const [meetLink, setMeetLink] = useState<string | null>(null);
  const [creatingMeet, setCreatingMeet] = useState(false);
  const [meetError, setMeetError] = useState<string | null>(null);
  const [meetCopied, setMeetCopied] = useState(false);

  // Aviso automático — minutos, fonte da mensagem (avulsa ou script) e
  // estado de cada uma.
  const [reminderMinutes, setReminderMinutes] = useState("30");
  const [reminderSource, setReminderSource] = useState<"custom" | "script">("custom");
  const [reminderMessage, setReminderMessage] = useState("");
  const [scripts, setScripts] = useState<MessageScriptOption[] | null>(null);
  const [scriptsLoading, setScriptsLoading] = useState(false);
  const [selectedScriptId, setSelectedScriptId] = useState("");
  const [reminderSaving, setReminderSaving] = useState(false);
  const [reminderError, setReminderError] = useState<string | null>(null);
  const messageTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Busca o template já salvo deste vendedor assim que o diálogo monta — a
  // 1ª bolha do preview animado só aparece ~1.2s depois (AnimatedPhonePreview),
  // tempo de sobra pra essa resposta chegar antes de qualquer coisa ser
  // exibida na prática.
  useEffect(() => {
    fetch("/api/meeting-invite-template")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { template?: string | null } | null) => {
        if (data?.template) setTemplate(data.template);
      })
      .catch(() => {});
  }, []);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const dueAt = new Date(task.dueAt);
  const hasClientNumber = !!(task.contact.whatsapp || task.contact.phone);
  const canSend = isWhatsAppConnected && hasClientNumber;
  const canScheduleReminder = isWhatsAppConnected && hasClientNumber;

  const vars = buildMeetingInviteVariables({
    contactName: task.contact.name,
    consultorName: task.owner.name,
    dueAt,
    meetingTitle: task.title,
  });
  const previewText = renderMeetingInviteMessage(template, vars);
  const ownCalendarUrl = buildGoogleCalendarUrl({ title: task.title, start: dueAt, durationMinutes: 60 });

  function handleTemplateChange(next: string) {
    setTemplate(next);
    // Salva instantaneamente (debounced) — a próxima reunião já abre com o
    // texto editado, sem precisar de um botão "Salvar" separado.
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch("/api/meeting-invite-template", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: next }),
      }).catch(() => {});
    }, 600);
  }

  async function handleSend() {
    setSending(true);
    setError(null);
    const res = await fetch(`/api/tasks/${task.id}/send-meeting-invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template }),
    });
    setSending(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao enviar convite");
      return;
    }
    setStep("sent");
    setTimeout(onClose, 1700);
  }

  async function handleCreateMeet() {
    setCreatingMeet(true);
    setMeetError(null);
    const res = await fetch(`/api/tasks/${task.id}/create-google-meet`, { method: "POST" });
    setCreatingMeet(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMeetError(data.error ?? "Erro ao criar o link do Meet");
      return;
    }
    setMeetLink(data.googleMeetLink ?? null);
    if (!data.googleMeetLink) {
      // Evento criado, mas o Google não devolveu o link de conferência
      // nesta resposta (raro — ver comentário em createGoogleCalendarEvent).
      setMeetError("O evento foi criado na sua agenda, mas o Google ainda não devolveu o link do Meet — confira direto na sua Agenda em alguns instantes.");
    }
  }

  function copyMeetLink() {
    if (!meetLink) return;
    navigator.clipboard.writeText(meetLink).then(() => {
      setMeetCopied(true);
      setTimeout(() => setMeetCopied(false), 1500);
    });
  }

  function openReminderSetup() {
    setReminderError(null);
    setStep("reminder-setup");
    if (scripts === null) {
      setScriptsLoading(true);
      fetch("/api/message-scripts")
        .then((r) => (r.ok ? r.json() : []))
        .then((data: MessageScriptOption[]) => setScripts(Array.isArray(data) ? data : []))
        .catch(() => setScripts([]))
        .finally(() => setScriptsLoading(false));
    }
  }

  function insertVariable(token: string) {
    const el = messageTextareaRef.current;
    if (!el) {
      setReminderMessage((prev) => prev + token);
      return;
    }
    const start = el.selectionStart ?? reminderMessage.length;
    const end = el.selectionEnd ?? reminderMessage.length;
    const next = reminderMessage.slice(0, start) + token + reminderMessage.slice(end);
    setReminderMessage(next);
    // Devolve o foco e o cursor logo depois do token inserido — sem isso,
    // clicar num 2º chip em seguida insere no lugar errado (o textarea
    // perde a seleção ao clicar num botão fora dele).
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function handleSaveReminder() {
    setReminderSaving(true);
    setReminderError(null);
    const body =
      reminderSource === "custom"
        ? { minutesBefore: Number(reminderMinutes), message: reminderMessage }
        : { minutesBefore: Number(reminderMinutes), scriptId: selectedScriptId };
    const res = await fetch(`/api/tasks/${task.id}/schedule-reminder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setReminderSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setReminderError(data.error ?? "Erro ao programar aviso");
      return;
    }
    setStep("reminder-saved");
  }

  const canSaveReminder =
    reminderSource === "custom" ? reminderMessage.trim().length > 0 : !!selectedScriptId;

  return (
    <Modal onClose={onClose} maxWidth="max-w-sm">
      {step === "prompt" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Reunião marcada</h2>
            <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
              {task.contact.name} · {formatDateTime(dueAt)}
            </p>
          </div>

          <AnimatedPhonePreview text={previewText} />

          {!hasClientNumber ? (
            <p className="rounded-lg bg-neutral-100 px-3 py-2 text-center text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
              Esse cliente não tem WhatsApp/celular cadastrado — não dá pra mandar o convite.
            </p>
          ) : !isWhatsAppConnected ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-center text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
              Seu WhatsApp não está conectado —{" "}
              <a href="/configuracoes/integracoes" className="font-medium underline underline-offset-2">
                conecte em Configurações
              </a>{" "}
              pra poder enviar.
            </p>
          ) : (
            <p className="text-center text-sm font-medium text-neutral-800 dark:text-neutral-200">
              Enviar link para o WhatsApp do cliente?
            </p>
          )}

          <div className="flex flex-col gap-2">
            {canSend && (
              <button type="button" onClick={() => setStep("compose")} className="btn-primary w-full justify-center">
                <MessageCircle className="h-4 w-4" strokeWidth={2} />
                Sim, enviar
              </button>
            )}

            {/* Google Meet — só aparece se o responsável tem a conexão certa; senão fica só o link manual de sempre, mais abaixo. */}
            {task.ownerHasGoogleCalendarWriteAccess &&
              (meetLink ? (
                <button
                  type="button"
                  onClick={copyMeetLink}
                  className="btn-secondary w-full justify-center"
                >
                  {meetCopied ? <Check className="h-4 w-4 text-emerald-500" strokeWidth={2.5} /> : <Copy className="h-4 w-4" strokeWidth={2} />}
                  {meetCopied ? "Link copiado!" : "Copiar link do Google Meet"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleCreateMeet}
                  disabled={creatingMeet}
                  className="btn-secondary w-full justify-center border border-neutral-200 dark:border-neutral-700"
                >
                  {creatingMeet ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : <Video className="h-4 w-4" strokeWidth={2} />}
                  {creatingMeet ? "Criando…" : "Criar link do Google Meet"}
                </button>
              ))}
            {meetError && <p className="text-center text-xs text-red-600 dark:text-red-400">{meetError}</p>}

            {canScheduleReminder && (
              <button type="button" onClick={openReminderSetup} className="btn-ghost w-full justify-center border border-neutral-200 dark:border-neutral-700">
                <Bell className="h-4 w-4" strokeWidth={2} />
                Programar aviso automático
              </button>
            )}

            <a
              href={ownCalendarUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost w-full justify-center border border-neutral-200 dark:border-neutral-700"
            >
              <CalendarPlus className="h-4 w-4" strokeWidth={2} />
              Adicionar à minha agenda Google
            </a>
            <button type="button" onClick={onClose} className="text-center text-xs text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300">
              {canSend ? "Agora não" : "Fechar"}
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
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Editar convite</h2>
          </div>

          <PhoneMock>
            <MessageBubblePreview text={previewText} />
          </PhoneMock>

          <div className="space-y-1">
            <textarea
              autoFocus
              value={template}
              onChange={(e) => handleTemplateChange(e.target.value)}
              rows={5}
              className="field-input text-sm"
            />
            <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
              Variáveis: {MEETING_INVITE_VARIABLES.map((v) => v.token).join(" ")} — mudança salva automaticamente pras próximas reuniões.
            </p>
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <button type="button" onClick={handleSend} disabled={sending} className="btn-primary w-full justify-center">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : <Send className="h-4 w-4" strokeWidth={2} />}
            {sending ? "Enviando…" : "Enviar pelo WhatsApp"}
          </button>
        </div>
      )}

      {step === "sent" && (
        <div className="animate-step-slide-in flex flex-col items-center gap-3 py-6 text-center">
          <AnimatedCheck className="h-10 w-10 text-emerald-500" justDrawn />
          <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Convite enviado pra {task.contact.name}!</p>
        </div>
      )}

      {step === "reminder-setup" && (
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
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Aviso automático</h2>
          </div>

          <div className="space-y-1">
            <label className="field-label">Enviar</label>
            <Select value={reminderMinutes} onChange={setReminderMinutes} options={REMINDER_MINUTES_PRESETS} className="w-full" />
          </div>

          <div className="inline-flex w-full rounded-md border border-neutral-200 bg-neutral-100 p-0.5 dark:border-neutral-800 dark:bg-neutral-800">
            <button
              type="button"
              onClick={() => setReminderSource("custom")}
              className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                reminderSource === "custom"
                  ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-900 dark:text-neutral-100"
                  : "text-neutral-500 dark:text-neutral-400"
              }`}
            >
              Escrever mensagem
            </button>
            <button
              type="button"
              onClick={() => setReminderSource("script")}
              className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                reminderSource === "script"
                  ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-900 dark:text-neutral-100"
                  : "text-neutral-500 dark:text-neutral-400"
              }`}
            >
              Usar um script
            </button>
          </div>

          {reminderSource === "custom" ? (
            <div className="space-y-1.5">
              <textarea
                ref={messageTextareaRef}
                autoFocus
                value={reminderMessage}
                onChange={(e) => setReminderMessage(e.target.value)}
                placeholder={`O que avisar ${task.contact.name.split(" ")[0]}?`}
                rows={4}
                className="field-input text-sm"
              />
              <div className="flex flex-wrap gap-1">
                {REMINDER_VARIABLES.map((v) => (
                  <button
                    key={v.token}
                    type="button"
                    onClick={() => insertVariable(v.token)}
                    title={v.label}
                    className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] font-medium text-neutral-600 transition-colors hover:border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                  >
                    {v.token}
                  </button>
                ))}
              </div>
            </div>
          ) : scriptsLoading ? (
            <p className="py-4 text-center text-sm text-neutral-400 dark:text-neutral-500">Carregando scripts…</p>
          ) : !scripts || scripts.length === 0 ? (
            <p className="rounded-lg bg-neutral-100 px-3 py-2 text-center text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
              Nenhum script cadastrado ainda — crie um em WhatsApp → Scripts, ou escreva uma mensagem avulsa.
            </p>
          ) : (
            <div className="scrollbar-thin max-h-48 space-y-1 overflow-y-auto">
              {scripts.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedScriptId(s.id)}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    selectedScriptId === s.id
                      ? "border-neutral-900 bg-neutral-50 dark:border-white dark:bg-neutral-800"
                      : "border-neutral-200 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800/60"
                  }`}
                >
                  <span className="truncate font-medium text-neutral-800 dark:text-neutral-200">{s.name}</span>
                  <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">
                    {s.steps.length} {s.steps.length === 1 ? "mensagem" : "mensagens"}
                  </span>
                </button>
              ))}
            </div>
          )}

          {reminderSource === "script" && scripts && scripts.length > 0 && (
            <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
              As mensagens saem em sequência, respeitando o intervalo configurado no script — se o script for longo, alguma pode sair já perto (ou depois) do horário da reunião.
            </p>
          )}

          {reminderError && <p className="text-sm text-red-600 dark:text-red-400">{reminderError}</p>}

          <button
            type="button"
            onClick={handleSaveReminder}
            disabled={reminderSaving || !canSaveReminder}
            className="btn-primary w-full justify-center"
          >
            {reminderSaving && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
            {reminderSaving ? "Programando…" : "Programar aviso"}
          </button>
        </div>
      )}

      {step === "reminder-saved" && (
        <div className="animate-step-slide-in flex flex-col items-center gap-3 py-6 text-center">
          <AnimatedCheck className="h-10 w-10 text-emerald-500" justDrawn />
          <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
            Aviso programado! Vai sair automaticamente {REMINDER_MINUTES_PRESETS.find((p) => p.value === reminderMinutes)?.label.toLowerCase() ?? `${reminderMinutes} min antes`} da reunião.
          </p>
          <button type="button" onClick={onClose} className="btn-ghost">
            Fechar
          </button>
        </div>
      )}
    </Modal>
  );
}
