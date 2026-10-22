/**
 * Datas e horários das telas de WhatsApp — UM lugar só, sempre no fuso de
 * America/Campo_Grande (ver lib/timezone.ts). Antes eram três cópias da mesma
 * lógica ("Hoje/Ontem/dia da semana") com resultados diferentes: a lista de
 * Conversas e o chat usavam o relógio do aparelho; a de Atendimentos, o fuso
 * da empresa.
 *
 * Puro (sem servidor) — roda no navegador e no servidor.
 */

import { brazilDateKey } from "@/lib/timezone";

const TZ = "America/Campo_Grande";
const TIME_FMT = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const SHORT_DATE_FMT = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const DAY_MONTH_FMT = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" });
const LONG_DATE_FMT = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" });
const FULL_FMT = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" });
const WEEKDAYS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function keyToUTC(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Chave do dia ("AAAA-MM-DD") no fuso da empresa — pra agrupar mensagens por dia. */
export function chatDayKey(value: string | Date): string {
  return brazilDateKey(toDate(value));
}

/** Quantos dias de calendário (no fuso da empresa) entre `value` e agora — 0 = hoje. */
function daysAgo(value: string | Date, now: Date): number {
  return Math.round((keyToUTC(brazilDateKey(now)) - keyToUTC(chatDayKey(value))) / 86_400_000);
}

function weekdayOf(value: string | Date): string {
  return WEEKDAYS[new Date(keyToUTC(chatDayKey(value))).getUTCDay()];
}

/** "14:32" */
export function formatChatClock(value: string | Date): string {
  return TIME_FMT.format(toDate(value));
}

/** "21/10/26 14:32" — pro texto de dica (title) do balão. */
export function formatChatFull(value: string | Date): string {
  return FULL_FMT.format(toDate(value));
}

/** Horário na lista de conversas: "14:32" hoje, "Ontem", dia da semana até 6 dias, senão "21/10/2026". */
export function formatChatListTime(value: string | Date, now: Date = new Date()): string {
  const diff = daysAgo(value, now);
  if (diff <= 0) return formatChatClock(value);
  if (diff === 1) return "Ontem";
  if (diff < 7) return weekdayOf(value);
  return SHORT_DATE_FMT.format(toDate(value));
}

/** Divisor de dia dentro do chat: "Hoje", "Ontem", dia da semana até 6 dias, senão "21 de outubro de 2026". */
export function formatChatDayDivider(value: string | Date, now: Date = new Date()): string {
  const diff = daysAgo(value, now);
  if (diff <= 0) return "Hoje";
  if (diff === 1) return "Ontem";
  if (diff < 7) return weekdayOf(value);
  return LONG_DATE_FMT.format(toDate(value));
}

/** "visto por último…": "hoje às 14:32", "ontem às 14:32", "em 18/10 às 14:32". */
export function formatLastSeen(value: string | Date, now: Date = new Date()): string {
  const diff = daysAgo(value, now);
  const time = formatChatClock(value);
  if (diff <= 0) return `hoje às ${time}`;
  if (diff === 1) return `ontem às ${time}`;
  return `em ${DAY_MONTH_FMT.format(toDate(value))} às ${time}`;
}
