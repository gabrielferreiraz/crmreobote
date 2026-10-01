import type { ComponentType } from "react";
import { StickyNote, Mail, Phone, FileText, Users2, MapPin, CheckCircle2, UserX, CalendarClock } from "lucide-react";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";

type IconComponent = ComponentType<{ className?: string; strokeWidth?: number }>;

/**
 * Abas de CRIAÇÃO de atividade manual (deal-detail.tsx). "Proposta" NÃO está
 * mais aqui: virou um módulo próprio e estruturado (Proposal — crédito, prazo,
 * parcela, cotas, estados enviada/aceita/refeita, ver lib/proposals e
 * components/proposals) e a antiga nota livre criava um SEGUNDO lugar de
 * registrar a mesma coisa, com números que nunca bateriam com o relatório
 * novo. POST /api/deals/[id]/activities também recusa type=PROPOSAL agora.
 */
export const ACTIVITY_TABS: { type: string; label: string; icon: IconComponent }[] = [
  { type: "NOTE", label: "Nota", icon: StickyNote },
  { type: "EMAIL", label: "E-mail", icon: Mail },
  { type: "CALL", label: "Ligação", icon: Phone },
  { type: "WHATSAPP", label: "WhatsApp", icon: WhatsAppIcon },
  { type: "VIDEO_CALL", label: "Videochamada", icon: Users2 },
  { type: "VISIT", label: "Visita", icon: MapPin },
];

/**
 * Atividades PROPOSAL antigas continuam existindo no histórico (timeline do
 * negócio, "Atividades recentes" do Início) — precisam manter ícone e rótulo,
 * senão cairiam no ícone genérico com o texto cru "PROPOSAL". Por isso os
 * mapas de LEITURA abaixo incluem este tipo mesmo ele tendo saído das abas de
 * criação acima.
 */
const LEGACY_DISPLAY_TYPES: { type: string; label: string; icon: IconComponent }[] = [
  { type: "PROPOSAL", label: "Proposta", icon: FileText },
];

export const ACTIVITY_ICON: Record<string, IconComponent> = Object.fromEntries(
  [...ACTIVITY_TABS, ...LEGACY_DISPLAY_TYPES].map((t) => [t.type, t.icon]),
);

export const ACTIVITY_LABEL: Record<string, string> = Object.fromEntries(
  [...ACTIVITY_TABS, ...LEGACY_DISPLAY_TYPES].map((t) => [t.type, t.label]),
);

// Starting point for the activity/task text — the user finishes the sentence.
export const ACTIVITY_BODY_TEMPLATES: Record<string, string> = {
  EMAIL: "E-mail: enviar e-mail para o cliente sobre ",
  CALL: "Ligação: ligar para o cliente sobre ",
  WHATSAPP: "WhatsApp: mandar mensagem para o cliente sobre ",
  VIDEO_CALL: "Videochamada: marcar videochamada com o cliente sobre ",
  VISIT: "Visita: agendar visita ao cliente sobre ",
};

/**
 * Resultado perguntado na CONCLUSÃO de uma Task VIDEO_CALL/VISIT (ver
 * components/meeting-outcome-dialog.tsx e ActivityMeetingOutcome no
 * schema) — alimenta o no-show do relatório de Facebook
 * (lib/meta-ads/attribution.ts) e a Taxa de comparecimento de Relatórios
 * (lib/reports/commercial-data.ts). "Realizada" (chave ATTENDED, sem
 * mudar o valor no banco — só o rótulo) em vez de "Compareceu": funciona
 * nos dois sentidos que importam aqui — "o encontro aconteceu" E "essa
 * etapa da tarefa foi cumprida". activeClass é a cor de "selecionado" de
 * cada botão — verde pra realizada, vermelho pra não compareceu, neutro
 * pra remarcou (não é nem bom nem ruim, só ainda não resolvido).
 */
export const MEETING_OUTCOME_OPTIONS: {
  value: "ATTENDED" | "NO_SHOW" | "RESCHEDULED";
  label: string;
  icon: IconComponent;
  activeClass: string;
  cardSelectedClass: string;
  iconSelectedClass: string;
}[] = [
  {
    value: "ATTENDED",
    label: "Realizada",
    icon: CheckCircle2,
    activeClass: "bg-emerald-600 text-white",
    cardSelectedClass: "border-emerald-500 bg-emerald-50/80 text-emerald-900 shadow-sm ring-2 ring-emerald-500/20 dark:border-emerald-500/80 dark:bg-emerald-950/40 dark:text-emerald-200",
    iconSelectedClass: "text-emerald-600 dark:text-emerald-400",
  },
  {
    value: "NO_SHOW",
    label: "Não compareceu",
    icon: UserX,
    activeClass: "bg-red-600 text-white",
    cardSelectedClass: "border-rose-500 bg-rose-50/80 text-rose-900 shadow-sm ring-2 ring-rose-500/20 dark:border-rose-500/80 dark:bg-rose-950/40 dark:text-rose-200",
    iconSelectedClass: "text-rose-600 dark:text-rose-400",
  },
  {
    value: "RESCHEDULED",
    label: "Remarcou",
    icon: CalendarClock,
    activeClass: "bg-neutral-700 text-white dark:bg-neutral-600",
    cardSelectedClass: "border-amber-500 bg-amber-50/80 text-amber-900 shadow-sm ring-2 ring-amber-500/20 dark:border-amber-500/80 dark:bg-amber-950/40 dark:text-amber-200",
    iconSelectedClass: "text-amber-600 dark:text-amber-400",
  },
];
