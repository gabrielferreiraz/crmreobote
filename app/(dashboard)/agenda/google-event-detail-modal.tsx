"use client";

import { X, Calendar as CalendarIcon, MapPin, FileText, ExternalLink } from "lucide-react";
import { Modal } from "@/components/modal";
import type { GoogleEvent } from "./task-calendar";

/** "seg, 10 de fev · 14:00 – 15:00" (com hora) ou "seg, 10 de fev" (dia inteiro/sem fim conhecido). */
function formatRange(event: GoogleEvent): string {
  const start = new Date(event.start);
  const dateLabel = start.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "long" });

  if (event.allDay) return dateLabel;

  const startTime = start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (!event.end) return `${dateLabel} · ${startTime}`;

  const end = new Date(event.end);
  const sameDay =
    start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth() && start.getDate() === end.getDate();
  const endTime = end.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  if (sameDay) return `${dateLabel} · ${startTime} – ${endTime}`;
  // Atravessa dia (raro, mas acontece) — mostra a data de término também.
  const endDateLabel = end.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "long" });
  return `${dateLabel} ${startTime} – ${endDateLabel} ${endTime}`;
}

/**
 * Detalhe de um evento vindo do Google Agenda (ver components/
 * google-calendar-connect.tsx) — só leitura, nunca editável aqui (edita no
 * próprio Google). Antes disso, clicar num evento saía direto pro Google
 * Calendar numa aba nova; agora mostra os detalhes no CRM primeiro, com um
 * botão pra abrir no Google só se precisar.
 */
export function GoogleEventDetailModal({ event, onClose }: { event: GoogleEvent; onClose: () => void }) {
  return (
    <Modal onClose={onClose} maxWidth="max-w-md">
      <div className="flex flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-neutral-100 pb-4 dark:border-neutral-800">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-500/10">
              <CalendarIcon className="h-5 w-5 text-blue-600 dark:text-blue-400" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <h2 className="text-base leading-snug font-semibold text-neutral-900 dark:text-neutral-100">{event.title}</h2>
              <p className="mt-0.5 text-xs text-neutral-400 capitalize dark:text-neutral-500">{formatRange(event)}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="icon-btn p-1 text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
            aria-label="Fechar"
          >
            <X className="h-4.5 w-4.5" strokeWidth={2} />
          </button>
        </div>

        <div className="space-y-3 py-4 text-sm text-neutral-700 dark:text-neutral-300">
          {event.location && (
            <p className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" strokeWidth={2} />
              <span>{event.location}</span>
            </p>
          )}
          {event.description ? (
            <p className="flex items-start gap-2 leading-relaxed whitespace-pre-wrap">
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" strokeWidth={2} />
              <span>{event.description}</span>
            </p>
          ) : (
            !event.location && <p className="italic text-neutral-400 dark:text-neutral-500">Sem mais detalhes neste evento.</p>
          )}
        </div>

        <a
          href={event.htmlLink}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary mt-1 w-full justify-center"
        >
          <ExternalLink className="h-4 w-4" strokeWidth={2} />
          Ver no Google Calendar
        </a>
      </div>
    </Modal>
  );
}
