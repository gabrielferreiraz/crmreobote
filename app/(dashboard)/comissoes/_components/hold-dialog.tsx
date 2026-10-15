"use client";

import { useState } from "react";
import { Modal } from "@/components/modal";
import { LoadingDots } from "@/components/loading-dots";

const QUICK_REASONS = ["Cliente não pagou a parcela", "Falta documento", "Aguardando a administradora"];

/**
 * Travar uma parcela = não pagar agora, com o motivo. O motivo é exatamente
 * o que a pessoa vai ler (na tela e no aviso do celular), então pede frase
 * curta e oferece as mais comuns prontas, em botões do tamanho de leitura.
 */
export function HoldDialog({
  personName,
  onClose,
  onConfirm,
}: {
  personName: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<string | null>;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return;
    setSaving(true);
    const err = await onConfirm(reason.trim());
    setSaving(false);
    if (err) setError(err);
  }

  return (
    <Modal onClose={() => !saving && onClose()} maxWidth="max-w-md">
      <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Por que travar esta parcela?</h2>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        Ela não é paga até alguém destravar. {personName.split(" ")[0]} recebe o motivo no celular.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {QUICK_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                reason === r
                  ? "border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-600 dark:bg-amber-500/15 dark:text-amber-100"
                  : "border-neutral-200 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <input
          className="field-input"
          value={reason}
          maxLength={140}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ou escreva com suas palavras"
          aria-label="Motivo"
          autoFocus
        />
        {error && <p className="field-error text-sm">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={saving || !reason.trim()}>
            {saving ? <LoadingDots /> : "Travar parcela"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
