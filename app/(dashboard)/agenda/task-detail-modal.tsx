"use client";

import Link from "next/link";
import { 
  X, 
  CalendarPlus, 
  CircleAlert, 
  CheckCircle2, 
  Clock, 
  Briefcase, 
  User, 
  Phone, 
  Tag, 
  FileText, 
  ExternalLink, 
  CircleDot, 
  Mail, 
  MessageSquare, 
  Calendar,
  UserCheck
} from "lucide-react";
import { TASK_TYPE_LABELS, TASK_TYPE_ICON, TASK_TYPE_COLOR } from "@/lib/task-icons";
import { Avatar } from "@/components/avatar";
import { AnimatedCheck } from "@/components/animated-check";
import { buildGoogleCalendarUrl } from "@/lib/google-calendar";
import { Modal } from "@/components/modal";
import type { Task } from "./task-row";

function formatDateTime(dateStr: string | Date | null): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function relativeTime(dueAt: string | Date | null, completed: boolean): { label: string; tone: "red" | "amber" | "green" | "neutral" } {
  if (completed) return { label: "Concluída", tone: "green" };
  if (!dueAt) return { label: "Sem prazo", tone: "neutral" };
  const diff = new Date(dueAt).getTime() - Date.now();
  const absMs = Math.abs(diff);
  const mins = Math.floor(absMs / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (diff < 0) {
    if (days > 0) return { label: `${days}d atrasada`, tone: "red" };
    if (hours > 0) return { label: `${hours}h atrasada`, tone: "red" };
    return { label: `${mins}min atrasada`, tone: "red" };
  }
  if (days > 1) return { label: `em ${days} dias`, tone: "neutral" };
  if (days === 1) return { label: "amanhã", tone: "amber" };
  if (hours > 0) return { label: `em ${hours}h`, tone: "amber" };
  return { label: `em ${mins}min`, tone: "amber" };
}

const TONE_COLOR: Record<string, string> = {
  red: "text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20",
  amber: "text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20",
  green: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20",
  neutral: "text-neutral-500 dark:text-neutral-400 bg-neutral-500/10 border border-neutral-500/20",
};

export function TaskDetailModal({
  task,
  completed,
  justCompleted,
  onClose,
  onToggle,
}: {
  task: Task;
  completed: boolean;
  justCompleted: boolean;
  onClose: () => void;
  onToggle: () => void;
}) {
  const Icon = TASK_TYPE_ICON[task.type] ?? TASK_TYPE_ICON.OTHER;
  const color = TASK_TYPE_COLOR[task.type] ?? TASK_TYPE_COLOR.OTHER;
  const overdue = !completed && !!task.dueAt && new Date(task.dueAt) < new Date();
  const rel = relativeTime(task.dueAt, completed);

  // Link para o chat interno do CRM
  const crmChatUrl = task.contact ? `/whatsapp/conversas?contactId=${task.contact.id}` : "";
  const phoneUrl = task.contact?.phone ? `tel:${task.contact.phone}` : "";
  const emailUrl = task.contact?.email ? `mailto:${task.contact.email}` : "";

  return (
    <Modal onClose={onClose} maxWidth="max-w-md">
      <div className="flex flex-col">
        {/* Top Header - Icon, Title and Close Button */}
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-neutral-100 dark:border-neutral-800">
          <div className="flex items-center gap-3">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${color.bg}`}>
              {completed ? (
                <AnimatedCheck className="h-5 w-5 text-emerald-500" justDrawn={justCompleted} />
              ) : overdue ? (
                <CircleAlert className="h-5 w-5 text-red-500" strokeWidth={2} />
              ) : (
                <Icon className={`h-5 w-5 ${color.text}`} strokeWidth={2} />
              )}
            </span>
            <div className="min-w-0">
              <h2 className={`text-base font-semibold leading-snug text-neutral-900 dark:text-neutral-100 ${completed ? "line-through opacity-50" : ""}`}>
                {task.title}
              </h2>
              {task.dueAt && (
                <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5">
                  {formatDateTime(task.dueAt)}
                </p>
              )}
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

        {/* Task Description */}
        <div className="py-4 text-sm text-neutral-700 dark:text-neutral-300 border-b border-neutral-100 dark:border-neutral-800">
          {task.description ? (
            <p className="whitespace-pre-wrap leading-relaxed">{task.description}</p>
          ) : (
            <p className="italic text-neutral-400 dark:text-neutral-500">Sem observações adicionais.</p>
          )}
        </div>

        {/* Details List (Agendor style: Simple list with icons) */}
        <div className="py-4 space-y-3.5 text-sm">
          {/* Prazo / Status */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-neutral-500 dark:text-neutral-400">
              <Clock className="h-4 w-4 shrink-0" strokeWidth={2} />
              <span>Status</span>
            </div>
            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${TONE_COLOR[rel.tone]}`}>
              {rel.label}
            </span>
          </div>

          {/* Vínculo de Negócio */}
          {task.deal && (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 text-neutral-500 dark:text-neutral-400">
                <Briefcase className="h-4 w-4 shrink-0" strokeWidth={2} />
                <span>Negócio</span>
              </div>
              <Link
                href={`/negocios/${task.deal.id}`}
                onClick={onClose}
                className="flex items-center gap-1 text-neutral-800 hover:text-neutral-900 hover:underline dark:text-neutral-200 dark:hover:text-white font-medium truncate max-w-[200px]"
              >
                {task.deal.name}
                {task.deal.value != null && (
                  <span className="text-emerald-600 dark:text-emerald-400 text-xs ml-1 font-bold">
                    ({new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(Number(task.deal.value))})
                  </span>
                )}
              </Link>
            </div>
          )}

          {/* Vínculo de Contato */}
          {task.contact && (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 text-neutral-500 dark:text-neutral-400">
                <User className="h-4 w-4 shrink-0" strokeWidth={2} />
                <span>Cliente</span>
              </div>
              <Link
                href={`/clientes/${task.contact.id}`}
                onClick={onClose}
                className="text-neutral-800 hover:text-neutral-900 hover:underline dark:text-neutral-200 dark:hover:text-white font-medium truncate max-w-[200px]"
              >
                {task.contact.name}
              </Link>
            </div>
          )}

          {/* Responsável */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-neutral-500 dark:text-neutral-400">
              <UserCheck className="h-4 w-4 shrink-0" strokeWidth={2} />
              <span>Para quem?</span>
            </div>
            <div className="flex items-center gap-2">
              <Avatar name={task.owner.name} src={task.owner.photoUrl} size="xs" />
              <span className="text-neutral-800 dark:text-neutral-200 font-medium">{task.owner.name}</span>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="pt-4 mt-2 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {/* Botão de abrir Chat no CRM (se WhatsApp e contato existirem) */}
            {task.type === "WHATSAPP" && task.contact && (
              <Link
                href={crmChatUrl}
                onClick={onClose}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors dark:border-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                Conversar no CRM
              </Link>
            )}

            {/* Ligação ou E-mail rápido */}
            {task.type === "CALL" && task.contact?.phone && (
              <a
                href={phoneUrl}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors dark:border-blue-800 dark:bg-blue-500/10 dark:text-blue-400 dark:hover:bg-blue-500/20"
              >
                <Phone className="h-3.5 w-3.5" />
                Ligar
              </a>
            )}

            {task.type === "EMAIL" && task.contact?.email && (
              <a
                href={emailUrl}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors dark:border-purple-800 dark:bg-purple-500/10 dark:text-purple-400 dark:hover:bg-purple-500/20"
              >
                <Mail className="h-3.5 w-3.5" />
                E-mail
              </a>
            )}

            {/* Link do Google Agenda se tiver prazo */}
            {task.dueAt && (
              <a
                href={buildGoogleCalendarUrl({ title: task.title, description: task.description, start: task.dueAt })}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-neutral-200 text-neutral-600 hover:bg-neutral-50 transition-colors dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
              >
                <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="4" width="18" height="17" rx="2" fill="#4285F4"/>
                  <path d="M3 6c0-1.1.9-2 2-2h14c1.1 0 2 .9 2 2v3H3V6z" fill="#34A853"/>
                  <rect x="6" y="9" width="12" height="9" rx="1" fill="white"/>
                  <text x="12" y="16" fill="#4285F4" font-family="sans-serif" font-size="8" font-weight="bold" text-anchor="middle">31</text>
                </svg>
                <span>Google Agenda</span>
              </a>
            )}
          </div>

          {/* Botão de Finalizar/Reabrir */}
          <button
            type="button"
            onClick={onToggle}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-sm active:scale-[0.98] ${
              completed
                ? "bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 border border-neutral-200 dark:border-neutral-700"
                : "bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 dark:bg-blue-500 dark:hover:bg-blue-600 dark:active:bg-blue-750"
            }`}
          >
            {completed ? "REABRIR" : "FINALIZAR"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
