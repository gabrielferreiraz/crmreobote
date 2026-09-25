"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, FileText, Loader2, Printer } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { proposalApi } from "@/lib/proposals/client";
import { PROPOSAL_STATUS_LABEL, formatProposalNumber, type ProposalDTO } from "@/lib/proposals/types";

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
    router.refresh();
    return true;
  }

  return (
    <aside className="no-print w-full lg:sticky lg:top-6 lg:w-64 lg:shrink-0">
      <div className="card space-y-4 p-3">
        <div className="flex items-start justify-between gap-3 lg:block">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">Proposta Nº {formatProposalNumber(proposal.number)}</p>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">Revisão {proposal.revision} · {PROPOSAL_STATUS_LABEL[proposal.status]}</p>
          </div>
          <Link href={`/negocios/${proposal.dealId}`} className="icon-btn h-8 w-8 shrink-0" aria-label="Voltar ao negócio" title="Voltar ao negócio">
            <ArrowLeft className="h-4 w-4" strokeWidth={2} />
          </Link>
        </div>

        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
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
              <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.5} />
              Enviei para o cliente
            </button>
          )}
        </div>

        <div className="grid gap-2 text-xs sm:grid-cols-3 lg:grid-cols-1">
          <StepBadge active={step >= 1} current={step === 1} label="1. Gerar" detail="Cria o documento" />
          <StepBadge active={step >= 2} current={step === 2} label="2. Salvar PDF" detail="Use imprimir no navegador" />
          <StepBadge active={step >= 3} current={step === 3} label="3. Marcar enviada" detail="Depois de enviar ao cliente" />
        </div>

        {proposal.status === "DRAFT" && <p className="text-xs text-neutral-500">Gere o documento para salvar o PDF.</p>}
        {proposal.status === "GENERATED" && <p className="text-xs text-neutral-500">Salve o PDF, envie ao cliente e marque como enviada.</p>}
        {proposal.status === "CANCELLED" && <p className="text-xs text-neutral-500">Proposta cancelada.</p>}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
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
      className={`border px-3 py-2 ${
        current
          ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
          : active
            ? "border-neutral-300 bg-neutral-50 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
            : "border-neutral-200 bg-neutral-50 text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-400"
      }`}
    >
      <p className="flex items-center gap-1.5 font-semibold">
        {active && !current && <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.5} />}
        {label}
      </p>
      <p className="mt-0.5 text-[11px] opacity-80">{detail}</p>
    </div>
  );
}
