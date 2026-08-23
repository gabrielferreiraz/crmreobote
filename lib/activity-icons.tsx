import type { ComponentType } from "react";
import { StickyNote, Mail, Phone, FileText, Users2, MapPin } from "lucide-react";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";

type IconComponent = ComponentType<{ className?: string; strokeWidth?: number }>;

export const ACTIVITY_TABS: { type: string; label: string; icon: IconComponent }[] = [
  { type: "NOTE", label: "Nota", icon: StickyNote },
  { type: "EMAIL", label: "E-mail", icon: Mail },
  { type: "CALL", label: "Ligação", icon: Phone },
  { type: "WHATSAPP", label: "WhatsApp", icon: WhatsAppIcon },
  { type: "PROPOSAL", label: "Proposta", icon: FileText },
  { type: "MEETING", label: "Reunião", icon: Users2 },
  { type: "VISIT", label: "Visita", icon: MapPin },
];

export const ACTIVITY_ICON: Record<string, IconComponent> = Object.fromEntries(
  ACTIVITY_TABS.map((t) => [t.type, t.icon]),
);

export const ACTIVITY_LABEL: Record<string, string> = Object.fromEntries(
  ACTIVITY_TABS.map((t) => [t.type, t.label]),
);

// Starting point for the activity/task text — the user finishes the sentence.
export const ACTIVITY_BODY_TEMPLATES: Record<string, string> = {
  EMAIL: "E-mail: enviar e-mail para o cliente sobre ",
  CALL: "Ligação: ligar para o cliente sobre ",
  WHATSAPP: "WhatsApp: mandar mensagem para o cliente sobre ",
  PROPOSAL: "Proposta: enviar proposta para o cliente sobre ",
  MEETING: "Reunião: marcar reunião com o cliente sobre ",
  VISIT: "Visita: agendar visita ao cliente sobre ",
};

/**
 * Resultado perguntado na CONCLUSÃO de uma Task MEETING/VISIT (ver
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
export const MEETING_OUTCOME_OPTIONS: { value: "ATTENDED" | "NO_SHOW" | "RESCHEDULED"; label: string; activeClass: string }[] = [
  { value: "ATTENDED", label: "Realizada", activeClass: "bg-emerald-600 text-white" },
  { value: "NO_SHOW", label: "Não compareceu", activeClass: "bg-red-600 text-white" },
  { value: "RESCHEDULED", label: "Remarcou", activeClass: "bg-neutral-700 text-white dark:bg-neutral-600" },
];
