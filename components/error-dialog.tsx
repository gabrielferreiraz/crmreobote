"use client";

import { AlertCircle, Lock, ServerCrash, FileQuestion, HelpCircle } from "lucide-react";
import { Modal } from "./modal";

export type ErrorType = "PERMISSION" | "NOT_FOUND" | "VALIDATION" | "SERVER" | "UNKNOWN";

export interface ErrorDialogProps {
  title?: string;
  message: string;
  type?: ErrorType;
  details?: string;
  onClose: () => void;
}

export function ErrorDialog({
  title,
  message,
  type = "UNKNOWN",
  details,
  onClose,
}: ErrorDialogProps) {
  const getConfig = () => {
    switch (type) {
      case "PERMISSION":
        return {
          icon: Lock,
          defaultTitle: "Sem permissão",
          badgeColor: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
          iconColor: "text-amber-600 dark:text-amber-400",
          iconBg: "bg-amber-50 dark:bg-amber-500/10",
        };
      case "NOT_FOUND":
        return {
          icon: FileQuestion,
          defaultTitle: "Não encontrado",
          badgeColor: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
          iconColor: "text-blue-600 dark:text-blue-400",
          iconBg: "bg-blue-50 dark:bg-blue-500/10",
        };
      case "VALIDATION":
        return {
          icon: AlertCircle,
          defaultTitle: "Dados inválidos",
          badgeColor: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
          iconColor: "text-orange-600 dark:text-orange-400",
          iconBg: "bg-orange-50 dark:bg-orange-500/10",
        };
      case "SERVER":
        return {
          icon: ServerCrash,
          defaultTitle: "Erro de servidor",
          badgeColor: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
          iconColor: "text-red-600 dark:text-red-400",
          iconBg: "bg-red-50 dark:bg-red-500/10",
        };
      default:
        return {
          icon: HelpCircle,
          defaultTitle: "Falha na ação",
          badgeColor: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
          iconColor: "text-rose-600 dark:text-rose-400",
          iconBg: "bg-rose-50 dark:bg-rose-500/10",
        };
    }
  };

  const config = getConfig();
  const IconComponent = config.icon;
  const displayTitle = title || config.defaultTitle;

  return (
    <Modal onClose={onClose} maxWidth="max-w-lg">
      <div className="flex items-start gap-4">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${config.iconBg}`}>
          <IconComponent className={`h-6 w-6 ${config.iconColor}`} strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{displayTitle}</h2>
          </div>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed font-medium">
            {message}
          </p>

          {details && (
            <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-400 font-mono break-words">
              <span className="font-semibold block mb-1 text-neutral-500 font-sans">Motivo:</span>
              {details}
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="btn-primary px-5 py-2 font-medium"
        >
          Entendido
        </button>
      </div>
    </Modal>
  );
}
