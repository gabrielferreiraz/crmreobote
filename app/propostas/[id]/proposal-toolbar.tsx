"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, FileText, Loader2, Printer } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { proposalApi } from "@/lib/proposals/client";
import { PROPOSAL_STATUS_LABEL, type ProposalDTO } from "@/lib/proposals/types";
import { trackUse } from "@/lib/feature-usage/track";

export function ProposalToolbar({ proposal }: { proposal: ProposalDTO }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);

  const canPrint = proposal.status !== "DRAFT" && proposal.status !== "CANCELLED";
  const step = proposal.status === "DRAFT" ? 1 : proposal.status === "GENERATED" ? 2 : 3;

  async function printProposal() {
    trackUse("proposta.pdf");
    await document.fonts.ready;
    const images = Array.from(document.querySelectorAll<HTMLImageElement>(".proposal-page img"));
    await Promise.all(images.map(async (image) => {
      if (!image.complete) {
        await new Promise<void>((resolve) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        });
      }
      await image.decode().catch(() => undefined);
    }));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    window.print();
  }

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

  const statusTone = proposal.status === "DRAFT" ? "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800" : proposal.status === "GENERATED" ? "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800" : proposal.status === "SENT" ? "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800" : "bg-neutral-100 text-neutral-800 border-neutral-300 dark:bg-neutral-800 dark:text-neutral-300";

  return (
    <aside className="no-print sticky top-3 sm:top-4 lg:top-6 z-40 w-full lg:w-64 lg:shrink-0 max-h-[calc(100vh-1.5rem)] overflow-y-auto">
      <div className="card space-y-4 p-4 shadow-md border border-neutral-200 dark:border-neutral-800">
        {/* Topo com Título e Voltar ao Negócio */}
        <div className="flex items-center justify-between gap-3 border-b border-neutral-200 dark:border-neutral-800 pb-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-extrabold text-neutral-950 dark:text-white">
              Painel de Emissão
            </p>
            <div className="mt-1 flex items-center gap-1.5 flex-wrap">
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusTone}`}>
                {PROPOSAL_STATUS_LABEL[proposal.status]}
              </span>
              <span className="text-[11px] font-bold text-neutral-500">Rev. {proposal.revision}</span>
            </div>
          </div>
          <Link
            href={`/negocios/${proposal.dealId}`}
            className="icon-btn h-9 w-9 shrink-0 rounded-full border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-700"
            aria-label="Voltar ao negócio"
            title="Voltar ao negócio"
          >
            <ArrowLeft className="h-4 w-4 text-neutral-700 dark:text-neutral-200" strokeWidth={2.5} />
          </Link>
        </div>

        {/* Orientação ao Usuário */}
        <div className="rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/70 dark:bg-sky-950/40 p-3 text-xs text-sky-950 dark:text-sky-200">
          <p className="font-extrabold text-[11px] uppercase tracking-wider text-sky-800 dark:text-sky-400">Próximo Passo:</p>
          <p className="mt-1 font-semibold leading-relaxed">
            {proposal.status === "DRAFT" && "Clique no botão 1 abaixo para gerar a versão oficial do PDF."}
            {proposal.status === "GENERATED" && "Baixe o PDF para seu aparelho e mande ao cliente pelo WhatsApp ou E-mail."}
            {proposal.status === "SENT" && "Proposta enviada e registrada no histórico do negócio com sucesso."}
            {proposal.status === "CANCELLED" && "Esta proposta está cancelada no histórico."}
          </p>
        </div>

        {/* Botões de Ação Direta */}
        <div className="space-y-2.5">
          {proposal.status === "DRAFT" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run("generate")}
              className="btn-primary w-full py-3 flex-col items-center justify-center text-center gap-0.5 shadow-sm"
            >
              <div className="flex items-center gap-2 font-extrabold text-sm">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : <FileText className="h-4 w-4" strokeWidth={2.5} />}
                <span>1. Gerar documento PDF</span>
              </div>
              <span className="text-[11px] font-normal opacity-90">Cria o arquivo oficial para download</span>
            </button>
          )}

          {canPrint && (
            <button
              type="button"
              onClick={printProposal}
              className={`${
                proposal.status === "GENERATED" ? "btn-primary bg-sky-600 hover:bg-sky-700 text-white shadow-md ring-2 ring-sky-400/40" : "btn-primary"
              } w-full py-3 flex-col items-center justify-center text-center gap-0.5`}
            >
              <div className="flex items-center gap-2 font-extrabold text-sm">
                <Printer className="h-4 w-4" strokeWidth={2.5} />
                <span>{proposal.status === "GENERATED" ? "2. Baixar / Salvar PDF" : "Baixar / Imprimir PDF"}</span>
              </div>
              <span className="text-[11px] font-normal opacity-90">Salva o PDF no celular ou PC</span>
            </button>
          )}

          {proposal.status === "GENERATED" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmSend(true)}
              className="btn-secondary w-full py-3 flex-col items-center justify-center text-center gap-0.5 border-emerald-600/40 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
            >
              <div className="flex items-center gap-2 font-extrabold text-sm">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" strokeWidth={2.5} />
                <span>3. Marcar como Enviada</span>
              </div>
              <span className="text-[11px] font-normal opacity-90">Confirma entrega ao cliente</span>
            </button>
          )}
        </div>

        {/* Guia Etapas */}
        <div className="space-y-1.5 pt-2 border-t border-neutral-200 dark:border-neutral-800">
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-neutral-500">Progresso:</p>
          <div className="grid grid-cols-1 gap-1.5 text-xs">
            <StepBadge active={step >= 1} current={step === 1} label="1. Gerar" detail="Documento criado" />
            <StepBadge active={step >= 2} current={step === 2} label="2. Baixar PDF" detail="Arquivo salvo no aparelho" />
            <StepBadge active={step >= 3} current={step === 3} label="3. Enviar ao Cliente" detail="Registrado no CRM" />
          </div>
        </div>

        {error && <p className="text-xs font-bold text-red-600 dark:text-red-400">{error}</p>}
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

