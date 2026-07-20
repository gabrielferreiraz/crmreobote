/**
 * Convite de reunião mandado pro WhatsApp do cliente — texto editável (com
 * variáveis, ver `MEETING_INVITE_VARIABLES`) + um link "adicionar ao
 * calendário" que abre a tela de criar evento do Google já preenchida pro
 * PRÓPRIO cliente salvar na agenda dele. Não é o mesmo link "Google Agenda"
 * que já existe em TaskDetailModal/TaskRow — aquele é pro vendedor salvar
 * na agenda DELE; este vai dentro da mensagem, pro cliente.
 */

import { buildGoogleCalendarUrl } from "@/lib/google-calendar";

export const DEFAULT_MEETING_INVITE_TEMPLATE =
  "Oi {cliente}! Aqui é o {consultor} 🙂\n\n" +
  "Confirmando nossa reunião marcada para *{data} às {hora}*.\n\n" +
  "Adiciona na sua agenda com um toque: {link}\n\n" +
  "Qualquer imprevisto, me chama por aqui!";

export const MEETING_INVITE_VARIABLES = [
  { token: "{cliente}", label: "Nome do cliente" },
  { token: "{consultor}", label: "Seu nome" },
  { token: "{data}", label: "Data da reunião" },
  { token: "{hora}", label: "Hora da reunião" },
  { token: "{link}", label: "Link pra adicionar na agenda" },
] as const;

export type MeetingInviteVariables = {
  cliente: string;
  consultor: string;
  data: string;
  hora: string;
  link: string;
};

/** Troca {token} pelo valor correspondente — token sem valor conhecido não quebra, só não é substituído. */
export function renderMeetingInviteMessage(template: string, vars: MeetingInviteVariables): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = (vars as Record<string, string | undefined>)[key];
    return value ?? match;
  });
}

/**
 * Monta as variáveis a partir dos dados já conhecidos da tarefa — duração
 * fixa de 60min (reunião custuma ser mais longa que o padrão de 30min do
 * link "quick add" genérico de outras telas).
 */
export function buildMeetingInviteVariables(params: {
  contactName: string;
  consultorName: string;
  dueAt: Date;
  meetingTitle: string;
}): MeetingInviteVariables {
  const { contactName, consultorName, dueAt, meetingTitle } = params;
  const link = buildGoogleCalendarUrl({
    title: `Reunião com ${consultorName}`,
    description: meetingTitle,
    start: dueAt,
    durationMinutes: 60,
  });
  return {
    cliente: contactName,
    consultor: consultorName,
    data: dueAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" }),
    hora: dueAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }),
    link,
  };
}
