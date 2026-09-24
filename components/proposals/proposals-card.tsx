"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, FileText, Loader2, Pencil, Plus, RotateCcw, Send, Trash2, X, Ban } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ProposalFormDialog } from "@/components/proposals/proposal-form-dialog";
import { formatCurrency } from "@/lib/format";
import { proposalApi } from "@/lib/proposals/client";
import {
  PROPOSAL_STATUS_LABEL,
  PROPOSAL_STATUS_TONE,
  allowedProposalActions,
  creditPerQuota,
  formatProposalNumber,
  type ProposalAction,
  type ProposalDTO,
} from "@/lib/proposals/types";

const TZ = "America/Sao_Paulo";
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ });
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: TZ });

type ConfirmKind = "send" | "accept" | "decline" | "redo" | "cancel" | "delete";

const CONFIRM_COPY: Record<ConfirmKind, { title: string; description: string; label: string; danger: boolean }> = {
  send: {
    title: "Você já enviou esta proposta ao cliente?",
    description:
      "Marque como enviada só depois de mandar o PDF de verdade (WhatsApp, e-mail...). A partir daí os valores ficam travados — pra mudar, use “Refazer”.",
    label: "Sim, foi enviada",
    danger: false,
  },
  accept: {
    title: "O cliente aceitou esta proposta?",
    description: "A proposta fecha como aceita e entra no relatório de conversão.",
    label: "Sim, aceitou",
    danger: false,
  },
  decline: {
    title: "O cliente não aceitou esta proposta?",
    description: "A proposta fecha como recusada e entra no relatório de conversão. Se ele só pediu outra condição, use “Refazer”.",
    label: "Sim, não aceitou",
    danger: true,
  },
  redo: {
    title: "Refazer esta proposta?",
    description:
      "A atual fica no histórico como “Refeita” (o cliente pediu outra condição — não conta como recusa) e nasce uma nova revisão com os mesmos valores pra você ajustar.",
    label: "Refazer",
    danger: false,
  },
  cancel: {
    title: "Cancelar esta proposta?",
    description: "Ela continua no histórico como cancelada — propostas não são apagadas depois de geradas.",
    label: "Cancelar proposta",
    danger: true,
  },
  delete: {
    title: "Apagar este rascunho?",
    description: "Só rascunhos podem ser apagados — some de vez.",
    label: "Apagar",
    danger: true,
  },
};

/**
 * Cartão "Propostas" do negócio — lista de revisões, cada uma com as ações
 * que o ESTADO dela permite (fonte única: allowedProposalActions em
 * lib/proposals/types.ts, a mesma máquina de estados que o servidor aplica).
 * Substitui a antiga aba de atividade "Proposta" (nota livre).
 *
 * Nenhum estado local de lista: a fonte de verdade é o `proposals` que vem do
 * servidor via props; cada ação chama a API e depois `router.refresh()` — o
 * mesmo padrão que o resto de deal-detail.tsx já usa, e evita duas cópias
 * (local + servidor) divergindo depois de um 409 de outra aba.
 */
export function ProposalsCard({
  dealId,
  proposals,
  defaultDescription,
}: {
  dealId: string;
  proposals: ProposalDTO[];
  defaultDescription: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState<{ proposal: ProposalDTO | null } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: ConfirmKind; proposal: ProposalDTO } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Executa uma ação; devolve o payload em caso de sucesso, null em caso de erro (já mostrado no cartão). */
  async function perform<T>(proposal: ProposalDTO, call: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>): Promise<T | null> {
    setBusyId(proposal.id);
    setError(null);
    const res = await call();
    setBusyId(null);
    // Atualiza mesmo no erro: o mais comum é "a proposta mudou de estado em
    // outra aba" (409) — reler do servidor já mostra o estado de verdade.
    router.refresh();
    if (!res.ok) {
      setError(res.error);
      return null;
    }
    return res.data;
  }

  async function runConfirmed(kind: ConfirmKind, p: ProposalDTO) {
    switch (kind) {
      case "send":
        await perform(p, () => proposalApi.action(p.id, "send"));
        break;
      case "accept":
        await perform(p, () => proposalApi.action(p.id, "accept"));
        break;
      case "decline":
        await perform(p, () => proposalApi.action(p.id, "decline"));
        break;
      case "cancel":
        await perform(p, () => proposalApi.action(p.id, "cancel"));
        break;
      case "delete":
        await perform(p, () => proposalApi.remove(p.id));
        break;
      case "redo": {
        const result = await perform(p, () => proposalApi.action<{ superseded: ProposalDTO; created: ProposalDTO }>(p.id, "redo"));
        // Abre a revisão nova já pronta pra editar — o ponto de "Refazer" é
        // mudar o que o cliente pediu, não ficar olhando uma cópia igual.
        if (result) setForm({ proposal: result.created });
        break;
      }
    }
    setConfirm(null);
  }

  async function generateAndOpen(p: ProposalDTO) {
    const res = await perform(p, () => proposalApi.action(p.id, "generate"));
    if (res) router.push(`/propostas/${p.id}`);
  }

  async function duplicateFrom(p: ProposalDTO) {
    const created = await perform(p, () => proposalApi.createFrom(dealId, p.id));
    if (created) setForm({ proposal: created });
  }

  const open = proposals.filter((p) => p.status === "DRAFT" || p.status === "GENERATED" || p.status === "SENT").length;

  return (
    <div className="card space-y-3 border border-neutral-200 p-4 text-sm shadow-sm dark:border-neutral-800/80">
      <div className="flex items-center justify-between gap-2 border-b border-neutral-100 pb-2.5 dark:border-neutral-800">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-brand" strokeWidth={2} />
          <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">Propostas</h3>
          {open > 0 && (
            <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand dark:bg-brand/20 dark:text-brand-light">
              {open} em aberto
            </span>
          )}
        </div>
        <button type="button" onClick={() => setForm({ proposal: null })} className="btn-secondary btn-sm">
          <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
          Nova
        </button>
      </div>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      {proposals.length === 0 ? (
        <p className="text-xs text-neutral-400 dark:text-neutral-500">
          Nenhuma proposta ainda. Crie uma pra gerar o documento em PDF pro cliente.
        </p>
      ) : (
        <div className="space-y-3">
          {proposals.map((p) => (
            <ProposalItem
              key={p.id}
              p={p}
              busy={busyId === p.id}
              onEdit={() => setForm({ proposal: p })}
              onGenerate={() => generateAndOpen(p)}
              onDuplicate={() => duplicateFrom(p)}
              onConfirm={(kind) => setConfirm({ kind, proposal: p })}
            />
          ))}
        </div>
      )}

      {form && (
        <ProposalFormDialog
          dealId={dealId}
          proposal={form.proposal}
          defaultDescription={defaultDescription}
          onClose={() => setForm(null)}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={CONFIRM_COPY[confirm.kind].title}
          description={CONFIRM_COPY[confirm.kind].description}
          confirmLabel={CONFIRM_COPY[confirm.kind].label}
          danger={CONFIRM_COPY[confirm.kind].danger}
          onClose={() => setConfirm(null)}
          onConfirm={() => runConfirmed(confirm.kind, confirm.proposal)}
        />
      )}
    </div>
  );
}

function ProposalItem({
  p,
  busy,
  onEdit,
  onGenerate,
  onDuplicate,
  onConfirm,
}: {
  p: ProposalDTO;
  busy: boolean;
  onEdit: () => void;
  onGenerate: () => void;
  onDuplicate: () => void;
  onConfirm: (kind: ConfirmKind) => void;
}) {
  const actions = new Set<ProposalAction>(allowedProposalActions(p.status));
  const perQuota = creditPerQuota(p.credit, p.quotaCount);
  // Documento só existe a partir de GENERATED (e some pra CANCELLED — ver
  // canPrint em app/propostas/[id]/proposal-toolbar.tsx).
  const hasDocument = p.status !== "DRAFT" && p.status !== "CANCELLED";

  return (
    <div className={`rounded-lg border border-neutral-200 p-3 dark:border-neutral-800 ${p.status === "CANCELLED" ? "opacity-60" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-neutral-900 tabular-nums dark:text-neutral-100">
          Nº {formatProposalNumber(p.number)} · Revisão {p.revision}
        </p>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${PROPOSAL_STATUS_TONE[p.status]}`}>
          {PROPOSAL_STATUS_LABEL[p.status]}
        </span>
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <Field label="Crédito" value={formatCurrency(p.credit)} />
        <Field label="Parcela" value={formatCurrency(p.installment)} />
        <Field
          label="Cotas"
          value={p.quotaCount > 1 ? `${p.quotaCount} × ${formatCurrency(perQuota)}` : String(p.quotaCount)}
        />
        <Field label="Prazo" value={`${p.termMonths} ${p.termMonths === 1 ? "mês" : "meses"}`} />
      </dl>

      <div className="mt-2 space-y-0.5 text-[11px] text-neutral-400 dark:text-neutral-500">
        <p>
          Criada por {p.createdByName} · {fmtDate(p.createdAt)}
        </p>
        {p.generatedAt && <p>Gerada em {fmtDateTime(p.generatedAt)}</p>}
        {p.sentAt && (
          <p>
            Enviada{p.sentByName ? ` por ${p.sentByName}` : ""} em {fmtDateTime(p.sentAt)}
          </p>
        )}
        {p.resolvedAt && p.status !== "SENT" && (
          <p>
            {PROPOSAL_STATUS_LABEL[p.status]} em {fmtDateTime(p.resolvedAt)}
          </p>
        )}
        {p.status === "SENT" && <p className="text-amber-600 dark:text-amber-400">Aguardando resposta do cliente</p>}
      </div>

      {(actions.size > 0 || hasDocument) && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {busy && <Loader2 className="h-4 w-4 animate-spin text-neutral-400" strokeWidth={2.5} />}

          {actions.has("generate") && p.status === "DRAFT" && (
            <button type="button" disabled={busy} onClick={onGenerate} className="btn-primary btn-sm">
              <FileText className="h-3.5 w-3.5" strokeWidth={2} />
              Gerar documento
            </button>
          )}
          {hasDocument && (
            <Link href={`/propostas/${p.id}`} className={p.status === "GENERATED" ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
              Abrir documento
            </Link>
          )}
          {actions.has("send") && (
            <button type="button" disabled={busy} onClick={() => onConfirm("send")} className="btn-secondary btn-sm">
              <Send className="h-3.5 w-3.5" strokeWidth={2} />
              Marcar como enviada
            </button>
          )}
          {actions.has("accept") && (
            <button type="button" disabled={busy} onClick={() => onConfirm("accept")} className="btn-primary btn-sm">
              <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
              Aceitou
            </button>
          )}
          {actions.has("decline") && (
            <button type="button" disabled={busy} onClick={() => onConfirm("decline")} className="btn-secondary btn-sm">
              <X className="h-3.5 w-3.5" strokeWidth={2.5} />
              Não aceitou
            </button>
          )}
          {actions.has("redo") && (
            <button type="button" disabled={busy} onClick={() => onConfirm("redo")} className="btn-secondary btn-sm">
              <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
              Refazer
            </button>
          )}
          {actions.has("duplicate") && (
            <button type="button" disabled={busy} onClick={onDuplicate} className="btn-secondary btn-sm">
              <Copy className="h-3.5 w-3.5" strokeWidth={2} />
              Nova a partir desta
            </button>
          )}
          {actions.has("edit") && (
            <button type="button" disabled={busy} onClick={onEdit} className="btn-ghost btn-sm">
              <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
              Editar
            </button>
          )}
          {actions.has("cancel") && (
            <button type="button" disabled={busy} onClick={() => onConfirm("cancel")} className="btn-ghost btn-sm">
              <Ban className="h-3.5 w-3.5" strokeWidth={2} />
              Cancelar
            </button>
          )}
          {actions.has("delete") && (
            <button type="button" disabled={busy} onClick={() => onConfirm("delete")} className="btn-ghost btn-sm">
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
              Apagar
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-neutral-400 dark:text-neutral-500">{label}</dt>
      <dd className="truncate font-medium text-neutral-800 tabular-nums dark:text-neutral-200">{value}</dd>
    </div>
  );
}
