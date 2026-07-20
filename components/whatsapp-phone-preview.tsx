"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Video, Phone as PhoneIcon, MoreVertical, CheckCheck } from "lucide-react";

type PreviewStep = { text: string };

const GAP_MS = 650;
const LOOP_PAUSE_MS = 2600;
const FIRST_MESSAGE_DELAY_MS = 500;

/** setTimeout em Promise — `signal.cancelled` é checado depois de cada espera pra
 * parar a sequência no meio (mudou o texto, ou o componente desmontou). */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mockup de celular com a conversa de WhatsApp simulada: o aparelho "chega"
 * na tela, depois cada mensagem aparece direto (com 2 tracinhos de enviada),
 * uma de cada vez. Reinicia sozinho sempre que o texto muda — pensado pra
 * ficar ao lado do editor de script, mostrando ao vivo como a mensagem vai
 * chegar pro lead.
 */
export function WhatsAppPhonePreview({
  steps,
  contactName = "Maria Silva",
}: {
  steps: PreviewStep[];
  contactName?: string;
}) {
  const [sentCount, setSentCount] = useState(0);

  const filledSteps = steps.filter((s) => s.text.trim().length > 0);
  const contentKey = filledSteps.map((s) => s.text).join(" ");

  useEffect(() => {
    setSentCount(0);
    if (filledSteps.length === 0) return;

    const signal = { cancelled: false };

    (async () => {
      await wait(FIRST_MESSAGE_DELAY_MS);
      while (!signal.cancelled) {
        for (let i = 0; i < filledSteps.length; i++) {
          if (signal.cancelled) return;
          setSentCount(i + 1);
          await wait(GAP_MS);
        }
        if (signal.cancelled) return;
        await wait(LOOP_PAUSE_MS);
        if (signal.cancelled) return;
        setSentCount(0);
      }
    })();

    return () => {
      signal.cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey]);

  return (
    <div className="animate-phone-in mx-auto w-[260px]">
      <div className="relative rounded-[2.2rem] border-[6px] border-neutral-900 bg-neutral-900 shadow-xl dark:border-neutral-700">
        <div className="absolute top-0 left-1/2 z-10 h-4 w-24 -translate-x-1/2 rounded-b-xl bg-neutral-900 dark:bg-neutral-700" />
        <div className="flex h-[460px] flex-col overflow-hidden rounded-[1.7rem] bg-[#e5ddd5] dark:bg-[#0b141a]">
          <div className="flex shrink-0 items-center gap-2 bg-[#008069] px-3 pt-6 pb-2.5 text-white dark:bg-[#202c33]">
            <ArrowLeft className="h-4 w-4 shrink-0" strokeWidth={2} />
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/25 text-[11px] font-semibold">
              {contactName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] leading-tight font-medium">{contactName}</p>
              <p className="truncate text-[10px] leading-tight text-white/75">online</p>
            </div>
            <Video className="h-4 w-4 shrink-0" strokeWidth={2} />
            <PhoneIcon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            <MoreVertical className="h-4 w-4 shrink-0" strokeWidth={2} />
          </div>

          <div className="scrollbar-thin flex-1 space-y-1.5 overflow-y-auto px-2.5 py-3">
            {filledSteps.length === 0 ? (
              <p className="mt-8 px-4 text-center text-xs text-neutral-500 dark:text-neutral-500">
                Escreva a mensagem pra ver a prévia aqui
              </p>
            ) : (
              filledSteps.map((step, i) => (i > sentCount - 1 ? null : <SentBubble key={i} text={step.text} />))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SentBubble({ text }: { text: string }) {
  return (
    <div className="animate-bubble-in ml-auto max-w-[82%] rounded-lg rounded-tr-sm bg-[#d9fdd3] px-2.5 py-1.5 shadow-sm dark:bg-[#005c4b]">
      <p className="text-[13px] whitespace-pre-wrap text-neutral-800 dark:text-neutral-100">{text}</p>
      <div className="mt-0.5 flex items-center justify-end gap-1">
        <span className="text-[10px] text-neutral-500 dark:text-neutral-400">agora</span>
        <CheckCheck className="h-3.5 w-3.5 text-neutral-400 dark:text-neutral-400" strokeWidth={2} />
      </div>
    </div>
  );
}
