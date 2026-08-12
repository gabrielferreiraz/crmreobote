"use client";

import { CheckCircle2, AlertTriangle } from "lucide-react";
import { Modal } from "./modal";

/**
 * Aviso de "só confirmar" (1 botão, sem cancelar) — mesmo espírito visual do
 * ConfirmDialog (ver confirm-dialog.tsx), mas pra sucesso/erro de uma ação já
 * concluída, não pra pedir confirmação antes dela acontecer. Existe pra
 * substituir `alert()`/`confirm()` nativos do navegador (feios, fora do
 * design do resto do app, sem dark mode) em telas que ainda usam isso.
 */
export function MessageDialog({
  tone = "success",
  title,
  description,
  onClose,
}: {
  tone?: "success" | "error";
  title: string;
  description?: string;
  onClose: () => void;
}) {
  const isError = tone === "error";

  return (
    <Modal onClose={onClose} maxWidth="max-w-md">
      <div className="flex gap-4">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
            isError ? "bg-red-50 dark:bg-red-500/15" : "bg-emerald-50 dark:bg-emerald-500/15"
          }`}
        >
          {isError ? (
            <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" strokeWidth={2} />
          ) : (
            <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" strokeWidth={2} />
          )}
        </div>
        <div className="mt-0.5 flex-1">
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
          {description && (
            <p className="mt-2 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">{description}</p>
          )}
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <button type="button" onClick={onClose} className="btn-primary">
          OK
        </button>
      </div>
    </Modal>
  );
}
