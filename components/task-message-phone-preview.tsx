"use client";

import { type CSSProperties, type ReactNode, useEffect, useState } from "react";

/**
 * Peças de preview de celular compartilhadas entre MeetingInviteDialog
 * (convite de reunião) e ScheduleMessageDialog (mensagem de WhatsApp
 * programada em tarefa) — extraídas de meeting-invite-dialog.tsx pra não
 * duplicar o mesmo mockup nos dois diálogos.
 */

/** Moldura de celular simplificada — cabeçalho estilo WhatsApp + área de conversa com o fundo de pontinhos já usado no chat de verdade. */
export function PhoneMock({ children }: { children: ReactNode }) {
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
 * Formatação do WhatsApp (*negrito*, _itálico_, ~tachado~) — os templates
 * usam essa sintaxe de verdade, então o preview precisa RENDERIZAR o
 * estilo, não mostrar os asteriscos/underscores literais como texto.
 */
export function renderWhatsAppFormatting(text: string): ReactNode[] {
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

export function TypingBubble() {
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

export function MessageBubblePreview({ text, animate }: { text: string; animate?: boolean }) {
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
export function AnimatedPhonePreview({ text }: { text: string }) {
  const [showBubble, setShowBubble] = useState(false);

  useEffect(() => {
    const appear = setTimeout(() => setShowBubble(true), 1200);
    return () => clearTimeout(appear);
  }, []);

  return <PhoneMock>{showBubble ? <MessageBubblePreview text={text} animate /> : <TypingBubble />}</PhoneMock>;
}
