"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CalendarPlus, Loader2, MessageCircle, Send, ChevronLeft } from "lucide-react";
import { Modal } from "./modal";
import { AnimatedCheck } from "./animated-check";
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
  owner: { name: string };
};

// Força horário de Brasília explicitamente — sem isso, usa o fuso do
// NAVEGADOR de quem está vendo a tela, que só bate com Brasília por
// coincidência. A variável {hora} do próprio template (buildMeetingInviteVariables,
// lib/meeting-invite.ts) já força America/Sao_Paulo; sem forçar aqui também,
// o cabeçalho deste diálogo podia mostrar um horário diferente do que vai na
// mensagem de verdade.
function formatDateTime(d: Date): string {
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

/** Moldura de celular simplificada — cabeçalho estilo WhatsApp + área de conversa com o fundo de pontinhos já usado no chat de verdade. */
function PhoneMock({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-52 overflow-hidden rounded-[1.4rem] border border-neutral-300 bg-white shadow-lg dark:border-neutral-700">
      <div className="flex items-center gap-2 bg-emerald-600 px-3 py-2">
        <span className="h-6 w-6 shrink-0 rounded-full bg-white/25" />
        <span className="h-2 w-20 rounded-full bg-white/40" />
      </div>
      <div className="chat-bg-dots relative flex min-h-[132px] flex-col justify-end bg-[#e5ded6] p-2.5 dark:bg-neutral-800">
        {children}
      </div>
    </div>
  );
}

/**
 * Formatação do WhatsApp (*negrito*, _itálico_, ~tachado~) — o template usa
 * essa sintaxe de verdade (ver DEFAULT_MEETING_INVITE_TEMPLATE), então o
 * preview precisa RENDERIZAR o estilo, não mostrar os asteriscos/underscores
 * literais como se fossem parte do texto.
 */
function renderWhatsAppFormatting(text: string): ReactNode[] {
  const parts = text.split(/(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g);
  return parts.map((part, i) => {
    if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) {
      return <strong key={i}>{part.slice(1, -1)}</strong>;
    }
    if (part.length > 2 && part.startsWith("_") && part.endsWith("_")) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    if (part.length > 2 && part.startsWith("~") && part.endsWith("~")) {
      return <s key={i}>{part.slice(1, -1)}</s>;
    }
    return part;
  });
}

function TypingBubble() {
  return (
    <div className="flex w-fit items-center gap-1 rounded-2xl rounded-bl-sm bg-white px-3 py-2.5 shadow-sm">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="animate-typing-bounce h-1.5 w-1.5 rounded-full bg-neutral-400"
          style={{ "--dot-delay": `${delay}ms` } as CSSProperties}
        />
      ))}
    </div>
  );
}

function MessageBubblePreview({ text, animate }: { text: string; animate?: boolean }) {
  return (
    <div
      className={`w-fit max-w-[85%] rounded-2xl rounded-bl-sm bg-white px-2.5 py-1.5 shadow-sm dark:bg-neutral-100 ${
        animate ? "animate-bubble-pop-in" : ""
      }`}
    >
      <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-neutral-800">{renderWhatsAppFormatting(text)}</p>
      <p className="mt-0.5 text-right text-[9px] text-neutral-400">agora</p>
    </div>
  );
}

/** Passo 1: digitando... → bolha chega → fica estática. Roda uma única vez (sem loop), só cosmético, não reflete edição em tempo real. */
function AnimatedPhonePreview({ text }: { text: string }) {
  const [showBubble, setShowBubble] = useState(false);

  useEffect(() => {
    const appear = setTimeout(() => setShowBubble(true), 1200);
    return () => clearTimeout(appear);
  }, []);

  return <PhoneMock>{showBubble ? <MessageBubblePreview text={text} animate /> : <TypingBubble />}</PhoneMock>;
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
  const [step, setStep] = useState<"prompt" | "compose" | "sent">("prompt");
  const [template, setTemplate] = useState(DEFAULT_MEETING_INVITE_TEMPLATE);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    </Modal>
  );
}
