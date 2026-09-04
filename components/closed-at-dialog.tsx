"use client";

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "./modal";
import { LoadingDots } from "./loading-dots";
import { DatePicker } from "./date-picker";
import { brazilDateKey } from "@/lib/timezone";
import { getServerTodayKey } from "@/app/actions/date-actions";

/**
 * Pergunta só a data de fechamento — usado tanto pra marcar Ganho de um
 * negócio só (negocios/[id]/deal-detail.tsx) quanto pro bulk "Marcar como
 * ganho" em massa (pipeline/deals-list.tsx, que passa `title`/`confirmLabel`
 * no plural). Extraído pra cá quando o bulk precisou do mesmo diálogo — só
 * havia 1 cópia, local ao detalhe do negócio, até então.
 *
 * O valor inicial do campo vem do SERVIDOR (getServerTodayKey), não do
 * relógio local do dispositivo — relógios de celular/PC podem estar errados
 * e causariam um closedAt gravado no dia errado (bug real: consultora com
 * relógio 1 dia atrasado, venda sumiu do ranking da TV).
 * Enquanto a resposta do servidor não chegou, o botão de confirmar fica
 * desabilitado — a espera típica é < 1s (1 round-trip), aceitável pra uma
 * ação de fechamento de negócio.
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
  // Fallback local enquanto a server action não respondeu — evita campo vazio
  // piscando, mas não permite confirmar com esse valor (ready=false).
  const [closedAt, setClosedAt] = useState(brazilDateKey());
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getServerTodayKey()
      .then((serverDate) => {
        setClosedAt(serverDate);
        setReady(true);
      })
      .catch(() => {
        // Se a action falhar (rede, servidor fora), aceita o fallback local.
        setReady(true);
      });
  }, []);

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
          <button type="submit" disabled={loading || !closedAt || !ready} className={confirmClassName}>
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
