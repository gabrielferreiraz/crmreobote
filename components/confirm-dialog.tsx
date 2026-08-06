"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Modal } from "./modal";
import { LoadingDots } from "./loading-dots";

export function ConfirmDialog({
  title,
  description,
  confirmLabel = "Confirmar",
  danger = true,
  onConfirm,
  onClose,
}: {
  title: string;
  description?: string;
  confirmLabel?: string;
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
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <button type="button" onClick={onClose} className="btn-secondary">
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={loading}
          className={
            danger
              ? "btn-primary bg-red-600 hover:bg-red-700 focus-visible:ring-red-500"
              : "btn-primary"
          }
        >
          {loading ? (
            <span className="inline-flex items-center gap-1">
              Aguarde
              <LoadingDots />
            </span>
          ) : (
            confirmLabel
          )}
        </button>
      </div>
    </Modal>
  );
}
