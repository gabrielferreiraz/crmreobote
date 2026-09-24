"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Printer, Send, FileText } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { proposalApi } from "@/lib/proposals/client";
import { PROPOSAL_STATUS_LABEL, PROPOSAL_STATUS_TONE, formatProposalNumber, type ProposalDTO } from "@/lib/proposals/types";

/**
 * Barra por CIMA da folha (tudo aqui é `no-print` — ver o <style> de
 * components/proposals/proposal-document.tsx). Concentra o caminho feliz de
 * quem acabou de gerar a proposta: imprimir/salvar o PDF e, depois de
 * mandar pro cliente, declarar "enviada" — no mesmo lugar em que acabou de
 * salvar o arquivo, sem precisar voltar pro negócio pra fazer isso.
 *
 * "Enviada" é SEMPRE um clique explícito aqui (com confirmação), nunca um
 * efeito colateral de imprimir: abrir o diálogo de impressão e cancelar, ou
 * salvar o PDF e esquecer de mandar, não pode aparecer no relatório como
 * proposta enviada (ver Proposal.generatedAt no schema).
 */
export function ProposalToolbar({ proposal }: { proposal: ProposalDTO }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);

  const canPrint = proposal.status !== "DRAFT" && proposal.status !== "CANCELLED";

  async function run(action: "generate" | "send") {
    setBusy(true);
    setError(null);
    const res = await proposalApi.action(proposal.id, action);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <div className="no-print mx-auto mb-4 w-[210mm] max-w-full">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link href={`/negocios/${proposal.dealId}`} className="btn-secondary btn-sm shrink-0">
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
            Voltar ao negócio
          </Link>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Proposta Nº {formatProposalNumber(proposal.number)} · Revisão {proposal.revision}
            </p>
            <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${PROPOSAL_STATUS_TONE[proposal.status]}`}>
              {PROPOSAL_STATUS_LABEL[proposal.status]}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {proposal.status === "DRAFT" && (
            <button type="button" disabled={busy} onClick={() => run("generate")} className="btn-primary btn-sm">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} /> : <FileText className="h-3.5 w-3.5" strokeWidth={2} />}
              Gerar documento
            </button>
          )}
          {canPrint && (
            <button type="button" onClick={() => window.print()} className={proposal.status === "GENERATED" ? "btn-secondary btn-sm" : "btn-primary btn-sm"}>
              <Printer className="h-3.5 w-3.5" strokeWidth={2} />
              Imprimir / Salvar PDF
            </button>
          )}
          {proposal.status === "GENERATED" && (
            <button type="button" disabled={busy} onClick={() => setConfirmSend(true)} className="btn-primary btn-sm">
              <Send className="h-3.5 w-3.5" strokeWidth={2} />
              Marcar como enviada
            </button>
          )}
        </div>
      </div>

      {proposal.status === "DRAFT" && (
        <p className="mt-2 text-xs text-neutral-500">Rascunho — gere o documento pra poder imprimir/salvar o PDF.</p>
      )}
      {proposal.status === "GENERATED" && (
        <p className="mt-2 text-xs text-neutral-500">
          Imprimir → &ldquo;Salvar como PDF&rdquo;, mande pro cliente e só então clique em &ldquo;Marcar como enviada&rdquo;.
        </p>
      )}
      {proposal.status === "CANCELLED" && <p className="mt-2 text-xs text-neutral-500">Proposta cancelada — não pode ser impressa.</p>}
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {confirmSend && (
        <ConfirmDialog
          title="Você já enviou esta proposta ao cliente?"
          description="Marque como enviada só depois de mandar o PDF de verdade (WhatsApp, e-mail...). A partir daí os valores ficam travados — pra mudar, use “Refazer”."
          confirmLabel="Sim, foi enviada"
          danger={false}
          onClose={() => setConfirmSend(false)}
          onConfirm={async () => {
            // Fecha de qualquer jeito — em caso de erro (ex.: a proposta
            // mudou de estado em outra aba), a mensagem aparece na barra por
            // trás do diálogo e ficaria invisível se ele continuasse aberto.
            await run("send");
            setConfirmSend(false);
          }}
        />
      )}
    </div>
  );
}
