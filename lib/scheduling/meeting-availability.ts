/**
 * Grade de horários pra agendar reunião com um consultor — usado só pela
 * landing page externa de captação de leads (Meta Ads) via API v1 (ver
 * app/api/v1/availability/route.ts e app/api/v1/appointments/route.ts), sem
 * UI correspondente dentro do CRM. Regras de negócio: 5 slots fixos por dia
 * útil, de 1h30 em 1h30 a partir das 08:30, HOJE entra na roda se ainda for
 * dia útil e tiver slot com antecedência mínima (ver MIN_LEAD_TIME_MINUTES),
 * e libera em cascata pro próximo dia útil quando o dia corrente não tem
 * mais vaga nenhuma — nunca mais de 1 dia por chamada.
 */

import { prisma } from "@/lib/prisma";
import {
  fetchGoogleCalendarEvents,
  getValidGoogleAccessToken,
  type GoogleCalendarEvent,
  type GoogleConnection,
} from "@/lib/google-calendar-oauth";
import { getBrazilParts, brazilDateTimeStringToUTC } from "@/lib/timezone";

export const MEETING_SLOT_TIMES = ["08:30", "10:00", "11:30", "13:00", "14:30"] as const;
export type MeetingSlotTime = (typeof MEETING_SLOT_TIMES)[number];

export function isMeetingSlotTime(value: string): value is MeetingSlotTime {
  return (MEETING_SLOT_TIMES as readonly string[]).includes(value);
}

// Duração considerada só pra checar conflito com o Google Agenda (o bloco
// reservado pro consultor é de 1h30 — o resto é folga pra prospectar ou
// absorver um no-show — mas a reunião de verdade dura uns 20-30min). Não é
// gravado em lugar nenhum, é só o "fim" do intervalo comparado contra os
// eventos existentes no Google.
const MEETING_CHECK_DURATION_MINUTES = 30;

// Antecedência mínima pra um slot de HOJE ainda ser oferecido — não basta
// "não passou", precisa sobrar tempo do consultor ver o aviso (WhatsApp/
// notificação) antes do horário chegar. Não faz diferença nenhuma pros
// slots de outros dias (sempre muito mais longe de "agora" que isso).
const MIN_LEAD_TIME_MINUTES = 45;

/**
 * Feriados nacionais: fora de escopo nesta primeira versão (pedido
 * original). Ponto isolado de propósito — pra entrar em escopo depois, é só
 * checar `dateKey` ("YYYY-MM-DD") contra uma lista/tabela de feriados aqui
 * dentro, sem mexer no resto da cascata.
 */
function isHoliday(dateKey: string): boolean {
  void dateKey;
  return false;
}

function dateKeyOf(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isBusinessDayDate(year: number, month: number, day: number): boolean {
  // year/month/day aqui já são um calendário civil discreto (não um
  // instante) — meio-dia UTC evita que qualquer arredondamento de fuso
  // empurre a data pro dia vizinho ao calcular o weekday.
  const weekday = new Date(Date.UTC(year, month, day, 12)).getUTCDay();
  return weekday >= 1 && weekday <= 5 && !isHoliday(dateKeyOf(year, month, day));
}

function addDays(year: number, month: number, day: number, delta: number) {
  const d = new Date(Date.UTC(year, month, day + delta));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
}

function firstBusinessDayOnOrAfter(year: number, month: number, day: number) {
  let candidate = { year, month, day };
  while (!isBusinessDayDate(candidate.year, candidate.month, candidate.day)) {
    candidate = addDays(candidate.year, candidate.month, candidate.day, 1);
  }
  return candidate;
}

/**
 * Primeiro dia útil elegível pra agendar a partir de "agora" — pode ser HOJE
 * (se hoje for dia útil), nunca antes de hoje. Hoje ainda pode acabar sem
 * nenhum slot de verdade depois do filtro de antecedência mínima em
 * getSlotsForDay — quem decide isso é a cascata (findNextAvailableDay), não
 * esta função.
 */
function earliestBookableDate(now: Date) {
  const today = getBrazilParts(now);
  return firstBusinessDayOnOrAfter(today.year, today.month, today.day);
}

/**
 * Confere que `dateKey` é um dia útil elegível pra agendar a partir de
 * agora (weekday válido + não anterior ao primeiro dia elegível). Usado na
 * revalidação de POST /api/v1/appointments — não confia em nada que o
 * cliente mandou como "disponível" sem checar aqui + isSlotStillAvailable.
 */
export function isLegitimateBookableDate(dateKey: string, now: Date = new Date()): boolean {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return false;
  if (!isBusinessDayDate(year, month - 1, day)) return false;
  const earliest = earliestBookableDate(now);
  return Date.UTC(year, month - 1, day) >= Date.UTC(earliest.year, earliest.month, earliest.day);
}

export type SlotStatus = { time: MeetingSlotTime; available: boolean };

/**
 * Disponibilidade dos 5 slots fixos de um dia pra um consultor — ocupado se
 * (a) o horário já passou (ou está a menos de MIN_LEAD_TIME_MINUTES de
 * "agora" — só importa de verdade pra HOJE, dias futuros nunca chegam perto
 * disso), (b) já existe Task type=MEETING ou VISIT dele nesse exato
 * horário, OU (c) o Google Agenda dele tem evento conflitando nesse
 * intervalo. Sem GoogleCalendarConnection, só (a)+(b) valem — não bloqueia
 * o fluxo inteiro por falta de conexão Google (pedido original); o mesmo
 * vale se a chamada ao Google falhar (token revogado, API fora do ar etc.).
 */
export async function getSlotsForDay(
  organizationId: string,
  consultorId: string,
  dateKey: string,
  connection: GoogleConnection | null,
  now: Date = new Date(),
): Promise<SlotStatus[]> {
  const slotTimes = MEETING_SLOT_TIMES.map((time) => ({ time, dueAt: brazilDateTimeStringToUTC(dateKey, time) }));

  const bookedTasks = await prisma.task.findMany({
    where: {
      organizationId,
      ownerId: consultorId,
      type: { in: ["MEETING", "VISIT"] },
      dueAt: { in: slotTimes.map((s) => s.dueAt) },
    },
    select: { dueAt: true },
  });
  const bookedTimes = new Set(bookedTasks.map((t) => t.dueAt!.getTime()));

  let googleEvents: GoogleCalendarEvent[] = [];
  if (connection) {
    try {
      const accessToken = await getValidGoogleAccessToken(connection);
      const dayStart = brazilDateTimeStringToUTC(dateKey, "00:00");
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      googleEvents = await fetchGoogleCalendarEvents(accessToken, dayStart, dayEnd);
    } catch (err) {
      console.error(
        `[scheduling] falha ao consultar Google Agenda de ${consultorId}, seguindo só com a checagem interna`,
        err,
      );
    }
  }

  const earliestOfferable = now.getTime() + MIN_LEAD_TIME_MINUTES * 60_000;

  return slotTimes.map(({ time, dueAt }) => {
    if (dueAt.getTime() <= earliestOfferable) return { time, available: false };
    if (bookedTimes.has(dueAt.getTime())) return { time, available: false };
    const slotEnd = new Date(dueAt.getTime() + MEETING_CHECK_DURATION_MINUTES * 60_000);
    const conflictsWithGoogle = googleEvents.some((event) => {
      if (event.allDay) return true;
      const eventEnd = event.end ?? new Date(event.start.getTime() + 60 * 60_000); // sem "end" (raro) — assume 1h de segurança
      return dueAt < eventEnd && slotEnd > event.start; // sobreposição clássica de intervalos
    });
    return { time, available: !conflictsWithGoogle };
  });
}

/** Revalida um único slot específico contra a mesma checagem (a)+(b)+(c) de getSlotsForDay — usado na hora de gravar a reserva. */
export async function isSlotStillAvailable(
  organizationId: string,
  consultorId: string,
  dateKey: string,
  time: MeetingSlotTime,
  connection: GoogleConnection | null,
  now: Date = new Date(),
): Promise<boolean> {
  const slots = await getSlotsForDay(organizationId, consultorId, dateKey, connection, now);
  return slots.find((s) => s.time === time)?.available ?? false;
}

export type AvailabilityResult = {
  date: string;
  slots: SlotStatus[];
  googleCalendarConnected: boolean;
};

/**
 * Cascata: acha o primeiro dia útil, a partir de HOJE, com pelo menos 1 slot
 * livre — nunca devolve mais de 1 dia por chamada. Teto de 60 dias úteis é
 * só segurança contra loop infinito (ex.: bug futuro em isHoliday marcando
 * tudo como feriado) — nenhum lead real chega perto disso.
 */
export async function findNextAvailableDay(
  organizationId: string,
  consultorId: string,
  now: Date = new Date(),
): Promise<AvailabilityResult> {
  const connection = await prisma.googleCalendarConnection.findUnique({ where: { userId: consultorId } });
  const googleCalendarConnected = !!connection;

  let candidate = earliestBookableDate(now);
  let lastSlots: SlotStatus[] = [];
  let lastDateKey = "";

  for (let guard = 0; guard < 60; guard++) {
    lastDateKey = dateKeyOf(candidate.year, candidate.month, candidate.day);
    lastSlots = await getSlotsForDay(organizationId, consultorId, lastDateKey, connection, now);
    if (lastSlots.some((s) => s.available)) {
      return { date: lastDateKey, slots: lastSlots, googleCalendarConnected };
    }
    const next = addDays(candidate.year, candidate.month, candidate.day, 1);
    candidate = firstBusinessDayOnOrAfter(next.year, next.month, next.day);
  }

  return { date: lastDateKey, slots: lastSlots, googleCalendarConnected };
}
