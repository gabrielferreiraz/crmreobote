"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "./modal";
import { LoadingDots } from "./loading-dots";
import { DatePicker } from "./date-picker";
import { brazilDateKey } from "@/lib/timezone";

/**
 * Pergunta só a data de fechamento — usado tanto pra marcar Ganho de um
 * negócio só (negocios/[id]/deal-detail.tsx) quanto pro bulk "Marcar como
 * ganho" em massa (pipeline/deals-list.tsx, que passa `title`/`confirmLabel`
 * no plural). Extraído pra cá quando o bulk precisou do mesmo diálogo — só
 * havia 1 cópia, local ao detalhe do negócio, até então.
 */
export function ClosedAtDialog({
  title,
  confirmLabel,
  confirmClassName,
  onClose,
  onConfirm,
}: {
  title: string;
  confirmLabel: string;
  confirmClassName: string;
  onClose: () => void;
  onConfirm: (closedAt: string) => Promise<void>;
}) {
  const [closedAt, setClosedAt] = useState(brazilDateKey());
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await onConfirm(closedAt);
    setLoading(false);
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1">
          <label className="field-label">Data</label>
          <DatePicker value={closedAt} onChange={setClosedAt} />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button type="submit" disabled={loading || !closedAt} className={confirmClassName}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
            {loading ? (
              <span className="inline-flex items-center gap-1">
                Salvando
                <LoadingDots />
              </span>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
