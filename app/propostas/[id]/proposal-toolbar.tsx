"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, FileText, Loader2, Printer } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { proposalApi } from "@/lib/proposals/client";
import { PROPOSAL_STATUS_LABEL, formatProposalNumber, type ProposalDTO } from "@/lib/proposals/types";
import { trackUse } from "@/lib/feature-usage/track";

export function ProposalToolbar({ proposal }: { proposal: ProposalDTO }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);

  const canPrint = proposal.status !== "DRAFT" && proposal.status !== "CANCELLED";
  const step = proposal.status === "DRAFT" ? 1 : proposal.status === "GENERATED" ? 2 : 3;

  async function run(action: "generate" | "send") {
    setBusy(true);
    setError(null);
    const res = await proposalApi.action(proposal.id, action);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    trackUse(action === "generate" ? "proposta.gerar" : "proposta.enviada");
    router.refresh();
    return true;
  }

  return (
    <aside className="no-print w-full lg:sticky lg:top-6 lg:w-64 lg:shrink-0">
      <div className="card space-y-3.5 p-3.5 sm:p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Proposta Nº {formatProposalNumber(proposal.number)}
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Revisão {proposal.revision} · {PROPOSAL_STATUS_LABEL[proposal.status]}
            </p>
          </div>
          <Link
            href={`/negocios/${proposal.dealId}`}
            className="icon-btn h-8 w-8 shrink-0"
            aria-label="Voltar ao negócio"
            title="Voltar ao negócio"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={2} />
          </Link>
        </div>

        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
          {proposal.status === "DRAFT" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run("generate")}
              className="btn-primary btn-sm w-full justify-center"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : <FileText className="h-4 w-4" strokeWidth={2} />}
              Gerar documento
            </button>
          )}
          {canPrint && (
            <button
              type="button"
              onClick={() => {
                trackUse("proposta.pdf");
                window.print();
              }}
              className={`${
                proposal.status === "GENERATED" ? "btn-secondary" : "btn-primary"
              } btn-sm w-full justify-center`}
            >
              <Printer className="h-4 w-4" strokeWidth={2} />
              Imprimir / Salvar PDF
            </button>
          )}
          {proposal.status === "GENERATED" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmSend(true)}
              className="btn-primary btn-sm w-full justify-center"
            >
              <CheckCircle2 className="h-4 w-4" strokeWidth={2.5} />
              Enviei para o cliente
            </button>
          )}
        </div>

        {/* Indicadores de progresso rápidos */}
        <div className="grid grid-cols-3 gap-1.5 text-xs lg:grid-cols-1">
          <StepBadge active={step >= 1} current={step === 1} label="1. Gerar" detail="Cria o documento" />
          <StepBadge active={step >= 2} current={step === 2} label="2. Salvar PDF" detail="Salva o arquivo" />
          <StepBadge active={step >= 3} current={step === 3} label="3. Enviar" detail="Marca como entregue" />
        </div>

        {/* Textos de no máximo 3 frases */}
        <div className="rounded-md bg-neutral-100 dark:bg-neutral-800/60 p-2.5 text-xs text-neutral-600 dark:text-neutral-300">
          {proposal.status === "DRAFT" && (
            <p>Gere o documento oficial da proposta. Em seguida, você poderá baixar o PDF para enviar ao cliente.</p>
          )}
          {proposal.status === "GENERATED" && (
            <p>Salve o arquivo PDF em seu aparelho. Compartilhe com o cliente e confirme o envio para registrar no histórico.</p>
          )}
          {proposal.status === "SENT" && (
            <p>Proposta enviada ao cliente com sucesso. Os valores estão salvos no histórico deste negócio.</p>
          )}
          {proposal.status === "CANCELLED" && (
            <p>Esta proposta foi cancelada.</p>
          )}
        </div>

        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>

      {confirmSend && (
        <ConfirmDialog
          title="Você já enviou esta proposta ao cliente?"
          description="Marque como enviada só depois de mandar o PDF de verdade. A partir daí os valores ficam travados; para mudar, use Refazer."
          confirmLabel="Sim, foi enviada"
          danger={false}
          onClose={() => setConfirmSend(false)}
          onConfirm={async () => {
            await run("send");
            setConfirmSend(false);
          }}
        />
      )}
    </aside>
  );
}

function StepBadge({ active, current, label, detail }: { active: boolean; current: boolean; label: string; detail: string }) {
  return (
    <div
      className={`rounded border px-2 py-1.5 transition-colors ${
        current
          ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
          : active
            ? "border-neutral-300 bg-neutral-50 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
            : "border-neutral-200 bg-neutral-50/60 text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-500"
      }`}
    >
      <p className="flex items-center gap-1 font-semibold text-[11px] sm:text-xs">
        {active && !current && <CheckCircle2 className="h-3 w-3 shrink-0" strokeWidth={2.5} />}
        {label}
      </p>
      <p className="mt-0.5 text-[10px] opacity-75 truncate">{detail}</p>
    </div>
  );
}
