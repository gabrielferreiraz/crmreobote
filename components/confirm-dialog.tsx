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
    <Modal onClose={onClose}>
      <div className="flex gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
            danger ? "bg-red-50 dark:bg-red-500/15" : "bg-neutral-100 dark:bg-neutral-800"
          }`}
        >
          <AlertTriangle
            className={`h-4 w-4 ${danger ? "text-red-600 dark:text-red-400" : "text-neutral-600 dark:text-neutral-400"}`}
            strokeWidth={2}
          />
        </div>
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
          {description && <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{description}</p>}
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="btn-ghost">
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
