"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Modal } from "./modal";
import { LoadingDots } from "./loading-dots";

export function ConfirmDialog({
  title,
  description,
  error,
  confirmLabel = "Confirmar",
  closeLabel = "Cancelar",
  hideConfirm = false,
  danger = true,
  onConfirm,
  onClose,
}: {
  title: string;
  description?: string;
  /** Falha da própria confirmação (ex.: o servidor recusou) — renderizada em
   * vermelho, SEPARADA de `description`. Nunca jogue o erro dentro de
   * `description`: ele fica com cara de texto explicativo, a pessoa relê a
   * mesma frase e conclui que o botão não fez nada (foi exatamente o que
   * aconteceu no "Desfazer importação", ver components/import-history-dialog.tsx). */
  error?: string | null;
  confirmLabel?: string;
  /** Vira "Fechar" quando não há mais nada a confirmar (ver hideConfirm). */
  closeLabel?: string;
  /** Esconde o botão de confirmar — pra quando o servidor já recusou por um
   * motivo que NÃO muda tentando de novo (409/404). Deixar um botão que só
   * repete o mesmo erro é o que faz parecer "cliquei e não aconteceu nada". */
  hideConfirm?: boolean;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    await onConfirm();
    setLoading(false);
  }

  return (
    <Modal onClose={onClose} maxWidth="max-w-md">
      <div className="flex gap-4">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
            danger ? "bg-red-50 dark:bg-red-500/15" : "bg-neutral-100 dark:bg-neutral-800"
          }`}
        >
          <AlertTriangle
            className={`h-5 w-5 ${danger ? "text-red-600 dark:text-red-400" : "text-neutral-600 dark:text-neutral-400"}`}
            strokeWidth={2}
          />
        </div>
        <div className="flex-1 mt-0.5">
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
          {description && <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">{description}</p>}
          {error && (
            <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm leading-relaxed font-medium text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
              {error}
            </p>
          )}
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <button type="button" onClick={onClose} className="btn-secondary">
          {closeLabel}
        </button>
        {!hideConfirm && (
          <button type="button" onClick={handleConfirm} disabled={loading} className={danger ? "btn-danger" : "btn-primary"}>
            {loading ? (
              <span className="inline-flex items-center gap-1">
                Aguarde
                <LoadingDots />
              </span>
            ) : (
              confirmLabel
            )}
          </button>
        )}
      </div>
    </Modal>
  );
}
