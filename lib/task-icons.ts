import type { ComponentType } from "react";
import {
  StickyNote,
  Mail,
  Phone,
  FileText,
  Users2,
  MapPin,
  CircleDot,
} from "lucide-react";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";

type IconComponent = ComponentType<{ className?: string; strokeWidth?: number }>;

export const TASK_TYPE_LABELS: Record<string, string> = {
  CALL: "Ligação",
  WHATSAPP: "WhatsApp",
  EMAIL: "E-mail",
  MEETING: "Reunião",
  VISIT: "Visita",
  PROPOSAL: "Proposta",
  NOTE: "Nota",
  OTHER: "Outro",
};

export const TASK_TYPE_ICON: Record<string, IconComponent> = {
  CALL: Phone,
  WHATSAPP: WhatsAppIcon,
  EMAIL: Mail,
  MEETING: Users2,
  VISIT: MapPin,
  PROPOSAL: FileText,
  NOTE: StickyNote,
  OTHER: CircleDot,
};

// One distinct color per category, used on the calendar so types are told apart at a glance.
export const TASK_TYPE_COLOR: Record<string, { bg: string; text: string; dot: string }> = {
  CALL: { bg: "bg-blue-50 dark:bg-blue-500/15", text: "text-blue-700 dark:text-blue-300", dot: "bg-blue-500" },
  WHATSAPP: { bg: "bg-emerald-50 dark:bg-emerald-500/15", text: "text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" },
  EMAIL: { bg: "bg-cyan-50 dark:bg-cyan-500/15", text: "text-cyan-700 dark:text-cyan-300", dot: "bg-cyan-500" },
  MEETING: { bg: "bg-purple-50 dark:bg-purple-500/15", text: "text-purple-700 dark:text-purple-300", dot: "bg-purple-500" },
  VISIT: { bg: "bg-pink-50 dark:bg-pink-500/15", text: "text-pink-700 dark:text-pink-300", dot: "bg-pink-500" },
  PROPOSAL: { bg: "bg-amber-50 dark:bg-amber-500/15", text: "text-amber-700 dark:text-amber-300", dot: "bg-amber-500" },
  NOTE: { bg: "bg-neutral-100 dark:bg-neutral-800", text: "text-neutral-600 dark:text-neutral-400", dot: "bg-neutral-400" },
  OTHER: { bg: "bg-neutral-100 dark:bg-neutral-800", text: "text-neutral-600 dark:text-neutral-400", dot: "bg-neutral-400" },
};
