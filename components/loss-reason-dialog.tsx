"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "./modal";
import { LoadingDots } from "./loading-dots";
import { Select } from "./select";
import { DatePicker } from "./date-picker";
import { brazilDateKey } from "@/lib/timezone";

export type LossReasonOption = { id: string; label: string };

/**
 * Pergunta motivo + detalhe + data de fechamento — usado pra marcar Perdido
 * de um negócio só (negocios/[id]/deal-detail.tsx) e pro bulk "Marcar como
 * perdido" em massa (pipeline/deals-list.tsx, que passa `title` no plural e
 * nunca tem motivo/nota "atual" pra pré-preencher, já que são vários
 * negócios de uma vez). Extraído pra cá quando o bulk precisou do mesmo
 * diálogo — só havia 1 cópia, local ao detalhe do negócio, até então.
 */
export function LossReasonDialog({
  title = "Por que esse negócio foi perdido?",
  lossReasons,
  initialReasonId,
  initialNote,
  onClose,
  onConfirm,
}: {
  title?: string;
  lossReasons: LossReasonOption[];
  initialReasonId: string | null;
  initialNote: string | null;
  onClose: () => void;
  onConfirm: (lossReasonId: string, note: string, closedAt: string) => Promise<void>;
}) {
  const [reasonId, setReasonId] = useState(initialReasonId ?? "");
  const [note, setNote] = useState(initialNote ?? "");
  const [closedAt, setClosedAt] = useState(brazilDateKey());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "Outro" não diz nada sozinho — sem o detalhe, o motivo real do negócio
  // perdido some (ninguém vai saber depois o que "Outro" queria dizer).
  // Comparação normalizada (não só === "Outro") porque o label é editável
  // livremente em Configurações → Motivos de perda (ver reason-manager.tsx),
  // um espaço a mais ou maiúscula diferente não deveria quebrar essa regra.
  const selectedReason = lossReasons.find((r) => r.id === reasonId);
  const requiresNote = selectedReason?.label.trim().toLowerCase() === "outro";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reasonId) {
      setError("Selecione um motivo");
      return;
    }
    if (requiresNote && !note.trim()) {
      setError('Descreva o motivo em "Detalhes" — "Outro" sozinho não diz o que aconteceu');
      return;
    }
    setLoading(true);
    setError(null);
    await onConfirm(reasonId, note, closedAt);
    setLoading(false);
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1">
          <label className="field-label">Motivo</label>
          <Select
            autoFocus
            value={reasonId}
            onChange={setReasonId}
            options={[
              { value: "", label: "Selecione" },
              ...lossReasons.map((r) => ({ value: r.id, label: r.label })),
            ]}
          />
        </div>
        <div className="space-y-1">
          <label className="field-label">
            Detalhes {requiresNote ? <span className="text-red-500">*</span> : "(opcional)"}
          </label>
          <textarea
            autoFocus={requiresNote}
            required={requiresNote}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={requiresNote ? "O que aconteceu, já que não se encaixa nos outros motivos?" : undefined}
            className="field-input"
          />
        </div>
        <div className="space-y-1">
          <label className="field-label">Quando foi perdido?</label>
          <DatePicker value={closedAt} onChange={setClosedAt} />
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button type="submit" disabled={loading} className="btn-primary bg-red-600 hover:bg-red-700 focus-visible:ring-red-500">
            {loading && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
            {loading ? (
              <span className="inline-flex items-center gap-1">
                Salvando
                <LoadingDots />
              </span>
            ) : (
              "Marcar como perdido"
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
