"use client";

import { useState } from "react";
import { MessageCircle, Loader2 } from "lucide-react";
import { Modal } from "./modal";
import { LoadingDots } from "./loading-dots";

/**
 * Sugestão (não obrigatória) mostrada ao marcar uma tarefa PROPOSAL como
 * concluída ("enviada"): oferece criar na hora o lembrete de acompanhar se o
 * cliente já analisou, pro consultor não esquecer. Ver useProposalFollowUp
 * em app/(dashboard)/agenda/tasks-list.tsx — dispara só nessa transição
 * (pendente → concluída), nunca ao desmarcar.
 */
export function ProposalFollowUpDialog({
  contactName,
  dueAt,
  onConfirm,
  onClose,
}: {
  contactName: string | null;
  dueAt: Date;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    await onConfirm();
    setLoading(false);
  }

  const dateLabel = dueAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

  return (
    <Modal onClose={onClose} maxWidth="max-w-md">
      <div className="flex gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-500/15">
          <MessageCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400" strokeWidth={2} />
        </div>
        <div className="mt-0.5 flex-1">
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Proposta marcada como enviada</h2>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
            Quer criar uma tarefa de WhatsApp para {dateLabel} — “Acompanhar análise de proposta”
            {contactName ? ` com ${contactName}` : ""}?
          </p>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} disabled={loading} className="btn-ghost">
          Agora não
        </button>
        <button type="button" onClick={() => void handleConfirm()} disabled={loading} className="btn-primary">
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
              Criando
              <LoadingDots />
            </>
          ) : (
            "Criar tarefa"
          )}
        </button>
      </div>
    </Modal>
  );
}
