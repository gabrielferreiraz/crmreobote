"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Ban,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  FileText,
  HelpCircle,
  Loader2,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CurrencyInput } from "@/components/currency-input";
import { ProposalFormDialog } from "@/components/proposals/proposal-form-dialog";
import { formatCurrency } from "@/lib/format";
import { proposalApi } from "@/lib/proposals/client";
import { parseProposalFields, type ProposalFields } from "@/lib/proposals/validate";
import { trackUse } from "@/lib/feature-usage/track";
import type { FeatureKey } from "@/lib/feature-usage/features";
import {
  PROPOSAL_STATUS_LABEL,
  allowedProposalActions,
  creditPerQuota,
  formatPercent,
  isProposalOpen,
  type ProposalAction,
  type ProposalDTO,
} from "@/lib/proposals/types";

// Mesmo fuso do resto do sistema (MS, UTC-4) — NÃO "America/Sao_Paulo", que
// adianta 1h (ver lib/timezone.ts).
const TZ = "America/Campo_Grande";
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ });
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: TZ });

type ConfirmKind = "send" | "accept" | "decline" | "redo" | "cancel" | "delete";

const CONFIRM_COPY: Record<ConfirmKind, { title: string; description: string; label: string; danger: boolean }> = {
  send: {
    title: "Você já enviou esta proposta ao cliente?",
    description:
      "Marque como enviada só depois de mandar o PDF de verdade (WhatsApp, e-mail...). A partir daí os valores ficam travados. Para mudar, use Refazer.",
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
    description: "A proposta fecha como recusada e entra no relatório. Se ele só pediu outra condição, use Refazer.",
    label: "Sim, não aceitou",
    danger: true,
  },
  redo: {
    title: "Refazer esta proposta?",
    description:
      "A atual fica no histórico como Refeita (não conta como recusa) e nasce uma nova revisão com os mesmos valores para você ajustar.",
    label: "Refazer",
    danger: false,
  },
  cancel: {
    title: "Cancelar esta proposta?",
    description: "Ela continua no histórico como cancelada. Propostas não são apagadas depois de geradas.",
    label: "Cancelar proposta",
    danger: true,
  },
  delete: {
    title: "Apagar este rascunho?",
    description: "Só rascunhos podem ser apagados. Esta proposta some de vez.",
    label: "Apagar",
    danger: true,
  },
};

const STATUS_GUIDANCE: Record<ProposalDTO["status"], { title: string; detail: string }> = {
  DRAFT: {
    title: "Preencha e gere o documento",
    detail: "Rascunho ainda não virou PDF. Pode editar ou apagar sem deixar histórico.",
  },
  GENERATED: {
    title: "Salve o PDF e envie ao cliente",
    detail: "Gerar ou imprimir não marca como enviada. Clique em enviar só depois de mandar o arquivo.",
  },
  SENT: {
    title: "Aguardando resposta",
    detail: "Valores travados. Se o cliente pedir outra condição, use Refazer; se recusou, use Não aceitou.",
  },
  ACCEPTED: {
    title: "Cliente aceitou",
    detail: "Desfecho final. Esta proposta entra na conversão como aceita.",
  },
  DECLINED: {
    title: "Cliente não aceitou",
    detail: "Conta como recusa. Se ele voltar depois, crie uma nova a partir desta.",
  },
  SUPERSEDED: {
    title: "Revisão refeita",
    detail: "Não conta como recusa. Existe uma revisão mais nova para ajustar a condição pedida.",
  },
  CANCELLED: {
    title: "Cancelada",
    detail: "Descartada por erro ou duplicidade. Permanece no histórico.",
  },
};

const STATUS_BADGE_STYLE: Record<ProposalDTO["status"], string> = {
  DRAFT: "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400",
  GENERATED: "bg-blue-500/10 text-blue-700 border-blue-500/30 dark:text-blue-400",
  SENT: "bg-indigo-500/10 text-indigo-700 border-indigo-500/30 dark:text-indigo-400",
  ACCEPTED: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400",
  DECLINED: "bg-rose-500/10 text-rose-700 border-rose-500/30 dark:text-rose-400",
  SUPERSEDED: "bg-neutral-100 text-neutral-600 border-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:border-neutral-700",
  CANCELLED: "bg-neutral-100 text-neutral-500 border-neutral-200 dark:bg-neutral-800 dark:text-neutral-500 dark:border-neutral-700",
};

export function ProposalsCard({
  dealId,
  proposals,
  defaultDescription,
  embedded = false,
}: {
  dealId: string;
  proposals: ProposalDTO[];
  defaultDescription: string;
  embedded?: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<{ proposal: ProposalDTO | null } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: ConfirmKind; proposal: ProposalDTO } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  async function perform<T>(
    proposal: ProposalDTO,
    call: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>,
    feature?: FeatureKey,
  ): Promise<T | null> {
    setBusyId(proposal.id);
    setError(null);
    const res = await call();
    setBusyId(null);
    router.refresh();
    if (!res.ok) {
      setError(res.error);
      return null;
    }
    if (feature) trackUse(feature);
    return res.data;
  }

  async function runConfirmed(kind: ConfirmKind, p: ProposalDTO) {
    switch (kind) {
      case "send":
        await perform(p, () => proposalApi.action(p.id, "send"), "proposta.enviada");
        break;
      case "accept":
        await perform(p, () => proposalApi.action(p.id, "accept"), "proposta.aceita");
        break;
      case "decline":
        await perform(p, () => proposalApi.action(p.id, "decline"), "proposta.recusada");
        break;
      case "cancel":
        await perform(p, () => proposalApi.action(p.id, "cancel"));
        break;
      case "delete":
        await perform(p, () => proposalApi.remove(p.id));
        break;
      case "redo": {
        const result = await perform(p, () => proposalApi.action<{ superseded: ProposalDTO; created: ProposalDTO }>(p.id, "redo"), "proposta.refeita");
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

  async function saveInline(p: ProposalDTO, fields: ProposalFields): Promise<ProposalDTO | null> {
    setBusyId(p.id);
    setError(null);
    const result = await proposalApi.update(p.id, fields);
    setBusyId(null);
    if (!result.ok) {
      setError(result.error);
      return null;
    }
    return result.data;
  }

  const open = proposals.filter((p) => isProposalOpen(p.status)).length;
  const latest = proposals[0] ?? null;
  const pastRevisions = proposals.slice(1);

  return (
    <div
      className={`overflow-hidden border text-sm shadow-xs ${
        embedded
          ? "border-neutral-300 border-l-2 border-l-brand bg-neutral-50/60 dark:border-neutral-800 dark:border-l-brand dark:bg-neutral-900/40"
          : "card border-neutral-200 dark:border-neutral-800/80"
      }`}
    >
      {/* Cabeçalho */}
      <div className="border-b border-neutral-200 p-3.5 sm:p-4 dark:border-neutral-800">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-light text-brand dark:bg-brand-light/20">
              <FileText className="h-4 w-4" strokeWidth={2} />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">Propostas</h3>
                {open > 0 && (
                  <span className="hidden xs:inline-block rounded-full border border-brand/30 bg-brand-light/30 px-2 py-0.5 text-[11px] font-medium text-brand dark:text-brand-light">
                    {open} em aberto
                  </span>
                )}
              </div>
            </div>
          </div>
          <button type="button" onClick={() => setForm({ proposal: null })} className="btn-primary btn-sm shrink-0">
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            Nova Proposta
          </button>
        </div>
      </div>

      <div className="p-3.5 sm:p-4 space-y-3">
        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
            {error}
          </p>
        )}

        {proposals.length === 0 ? (
          <div className="border border-dashed border-neutral-300 p-6 text-center dark:border-neutral-700 rounded-lg">
            <FileText className="mx-auto h-7 w-7 text-neutral-300 dark:text-neutral-600" strokeWidth={1.8} />
            <p className="mt-2 text-sm font-medium text-neutral-800 dark:text-neutral-200">Nenhuma proposta criada</p>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              Crie uma proposta comercial para gerar a folha A4 e exportar o PDF.
            </p>
            <button type="button" onClick={() => setForm({ proposal: null })} className="btn-primary btn-sm mt-3">
              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
              Criar Primeira Proposta
            </button>
          </div>
        ) : (
          <>
            {/* Proposta Ativa / Mais Recente */}
            {latest && (
              <ActiveProposalCard
                key={`${latest.id}:${latest.status}`}
                p={latest}
                busy={busyId === latest.id}
                onSave={(fields) => saveInline(latest, fields)}
                onGenerate={() => generateAndOpen(latest)}
                onDuplicate={() => duplicateFrom(latest)}
                onConfirm={(kind) => setConfirm({ kind, proposal: latest })}
              />
            )}

            {/* Histórico de Revisões Anteriores */}
            {pastRevisions.length > 0 && (
              <div className="pt-2 border-t border-neutral-200/80 dark:border-neutral-800">
                <button
                  type="button"
                  onClick={() => setShowHistory(!showHistory)}
                  className="flex w-full items-center justify-between py-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    <RotateCcw className="h-3.5 w-3.5 text-neutral-400" />
                    Histórico de revisões anteriores ({pastRevisions.length})
                  </span>
                  {showHistory ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>

                {showHistory && (
                  <div className="mt-2 space-y-2">
                    {pastRevisions.map((p) => (
                      <PastRevisionRow
                        key={p.id}
                        p={p}
                        busy={busyId === p.id}
                        onDuplicate={() => duplicateFrom(p)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

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

function ActiveProposalCard({
  p,
  busy,
  onSave,
  onGenerate,
  onDuplicate,
  onConfirm,
}: {
  p: ProposalDTO;
  busy: boolean;
  onSave: (fields: ProposalFields) => Promise<ProposalDTO | null>;
  onGenerate: () => void;
  onDuplicate: () => void;
  onConfirm: (kind: ConfirmKind) => void;
}) {
  const [editingField, setEditingField] = useState<"credit" | "installment" | "quota" | "fee" | "term" | null>(null);
  const [savedProposal, setSavedProposal] = useState(p);
  const [creditInput, setCreditInput] = useState(p.credit.toFixed(2));
  const [installmentInput, setInstallmentInput] = useState(p.installment.toFixed(2));
  const [quotaInput, setQuotaInput] = useState(String(p.quotaCount));
  const [feeInput, setFeeInput] = useState(p.feePercent.toFixed(2));
  const [termInput, setTermInput] = useState(String(p.termMonths));
  const [editError, setEditError] = useState<string | null>(null);
  const [savedRecently, setSavedRecently] = useState(false);

  const actions = new Set<ProposalAction>(allowedProposalActions(savedProposal.status));
  const canInlineEdit = actions.has("edit");
  const draftCredit = Number(creditInput) || 0;
  const draftQuota = Number(quotaInput) || 0;
  const perQuota = creditPerQuota(draftCredit, draftQuota);
  const hasDocument = savedProposal.status !== "DRAFT" && savedProposal.status !== "CANCELLED";

  function resetField(field: NonNullable<typeof editingField>) {
    if (field === "credit") setCreditInput(savedProposal.credit.toFixed(2));
    if (field === "installment") setInstallmentInput(savedProposal.installment.toFixed(2));
    if (field === "quota") setQuotaInput(String(savedProposal.quotaCount));
    if (field === "fee") setFeeInput(savedProposal.feePercent.toFixed(2));
    if (field === "term") setTermInput(String(savedProposal.termMonths));
    setEditError(null);
    setEditingField(null);
  }

  async function saveEdit(field: NonNullable<typeof editingField>) {
    const parsed = parseProposalFields({
      credit: creditInput,
      installment: installmentInput,
      quotaCount: quotaInput,
      feePercent: feeInput,
      termMonths: termInput,
      description: savedProposal.description,
      displayName: savedProposal.displayName ?? "",
      coverIntro: savedProposal.coverIntro ?? "",
      coverDetails: savedProposal.coverDetails ?? "",
      coverImagePosition: savedProposal.coverImagePosition,
    });
    if (!parsed.ok) {
      setEditError(parsed.error);
      return;
    }
    setEditError(null);
    const previousProposal = savedProposal;
    setSavedProposal((current) => ({ ...current, ...parsed.value }));
    setEditingField((current) => (current === field ? null : current));
    const saved = await onSave(parsed.value);
    if (saved) {
      setSavedProposal(saved);
      setCreditInput(saved.credit.toFixed(2));
      setInstallmentInput(saved.installment.toFixed(2));
      setQuotaInput(String(saved.quotaCount));
      setFeeInput(saved.feePercent.toFixed(2));
      setTermInput(String(saved.termMonths));
      setSavedRecently(true);
      window.setTimeout(() => setSavedRecently(false), 1800);
    } else {
      setSavedProposal(previousProposal);
      setEditingField((current) => current ?? field);
    }
  }

  function fieldKeyDown(event: React.KeyboardEvent<HTMLInputElement>, field: NonNullable<typeof editingField>) {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") resetField(field);
  }

  return (
    <div className="rounded-lg border border-neutral-200/90 bg-white p-3.5 dark:border-neutral-800 dark:bg-neutral-900/80 shadow-2xs">
      {/* Topo do Card */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-neutral-900 dark:text-neutral-100 tabular-nums">Revisão {savedProposal.revision}</span>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE_STYLE[savedProposal.status]}`}>
            {PROPOSAL_STATUS_LABEL[savedProposal.status]}
          </span>
        </div>

        {/* Informação de Orientação em Tooltip/Badge discreta */}
        <div className="group relative flex items-center gap-1 text-[11px] text-neutral-400 dark:text-neutral-500 cursor-help">
          <span>{STATUS_GUIDANCE[savedProposal.status].title}</span>
          <HelpCircle className="h-3.5 w-3.5 text-neutral-400 group-hover:text-neutral-600 dark:group-hover:text-neutral-300 transition-colors" />
          <div className="pointer-events-none absolute right-0 top-full z-10 mt-1 hidden w-56 rounded-md bg-neutral-900 p-2 text-[11px] text-neutral-200 shadow-lg group-hover:block dark:bg-neutral-800 border border-neutral-700">
            {STATUS_GUIDANCE[savedProposal.status].detail}
          </div>
        </div>
      </div>

      {/* Faixa Única de Métricas (Metric Strip Horizontal) */}
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 rounded-md border border-neutral-200/80 bg-neutral-50/80 dark:border-neutral-800 dark:bg-neutral-800/40 p-2.5 divide-y sm:divide-y-0 sm:divide-x divide-neutral-200 dark:divide-neutral-700/60">
        <div className="min-h-[60px] p-1 sm:px-2.5">
          <span className="block text-[10px] font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">Crédito</span>
          {editingField === "credit" ? (
            <CurrencyInput
              value={creditInput}
              onChange={setCreditInput}
              onBlur={() => saveEdit("credit")}
              onKeyDown={(event) => fieldKeyDown(event, "credit")}
              autoFocus
              className="mt-1 border-brand/40 bg-sky-50/50 py-1 text-xs font-semibold tabular-nums ring-2 ring-brand/10 dark:bg-sky-950/20"
            />
          ) : (
            <button type="button" disabled={!canInlineEdit || busy} onClick={() => setEditingField("credit")} className="mt-0.5 block rounded border border-sky-200/80 bg-sky-50/40 px-1.5 py-0.5 text-left font-bold text-neutral-900 transition-colors enabled:hover:border-brand/40 enabled:hover:bg-sky-50 disabled:cursor-default disabled:border-transparent disabled:bg-transparent dark:border-sky-800/50 dark:bg-sky-950/20 dark:text-neutral-100 dark:enabled:hover:border-brand/40 tabular-nums text-xs sm:text-sm">
              {formatCurrency(savedProposal.credit)}
            </button>
          )}
        </div>
        <div className="min-h-[60px] p-1 pt-2 sm:px-2.5 sm:pt-1">
          <span className="block text-[10px] font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">Parcela</span>
          {editingField === "installment" ? (
            <CurrencyInput
              value={installmentInput}
              onChange={setInstallmentInput}
              onBlur={() => saveEdit("installment")}
              onKeyDown={(event) => fieldKeyDown(event, "installment")}
              autoFocus
              className="mt-1 border-brand/40 bg-sky-50/50 py-1 text-xs font-semibold tabular-nums ring-2 ring-brand/10 dark:bg-sky-950/20"
            />
          ) : (
            <button type="button" disabled={!canInlineEdit || busy} onClick={() => setEditingField("installment")} className="mt-0.5 block rounded border border-sky-200/80 bg-sky-50/40 px-1.5 py-0.5 text-left font-bold text-neutral-900 transition-colors enabled:hover:border-brand/40 enabled:hover:bg-sky-50 disabled:cursor-default disabled:border-transparent disabled:bg-transparent dark:border-sky-800/50 dark:bg-sky-950/20 dark:text-neutral-100 dark:enabled:hover:border-brand/40 tabular-nums text-xs sm:text-sm">
              {formatCurrency(savedProposal.installment)}
            </button>
          )}
        </div>
        <div className="min-h-[60px] p-1 pt-2 sm:px-2.5 sm:pt-1">
          <span className="block text-[10px] font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">Cotas</span>
          {editingField === "quota" ? (
            <div className="mt-1">
              <input
                inputMode="numeric"
                value={quotaInput}
                onChange={(event) => setQuotaInput(event.target.value.replace(/\D/g, "").slice(0, 3))}
                onBlur={() => saveEdit("quota")}
                onKeyDown={(event) => fieldKeyDown(event, "quota")}
                autoFocus
                className="field-input border-brand/40 bg-sky-50/50 py-1 text-xs font-semibold tabular-nums ring-2 ring-brand/10 dark:bg-sky-950/20"
              />
              {draftQuota > 0 && <span className="mt-1 block truncate text-[10px] text-neutral-400">{formatCurrency(perQuota)} por cota</span>}
            </div>
          ) : (
            <button type="button" disabled={!canInlineEdit || busy} onClick={() => setEditingField("quota")} className="mt-0.5 block rounded border border-sky-200/80 bg-sky-50/40 px-1.5 py-0.5 text-left font-medium text-neutral-800 transition-colors enabled:hover:border-brand/40 enabled:hover:bg-sky-50 disabled:cursor-default disabled:border-transparent disabled:bg-transparent dark:border-sky-800/50 dark:bg-sky-950/20 dark:text-neutral-200 dark:enabled:hover:border-brand/40 tabular-nums text-xs sm:text-sm">
              {savedProposal.quotaCount > 1 ? `${savedProposal.quotaCount} x ${formatCurrency(perQuota)}` : `${savedProposal.quotaCount} cota`}
            </button>
          )}
        </div>
        <div className="min-h-[60px] p-1 pt-2 sm:px-2.5 sm:pt-1">
          <span className="block text-[10px] font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">Taxa</span>
          {editingField === "fee" ? (
            <div className="relative mt-1">
              <input
                inputMode="decimal"
                value={feeInput}
                onChange={(event) => setFeeInput(event.target.value.replace(/[^\d,.]/g, "").slice(0, 6))}
                onBlur={() => saveEdit("fee")}
                onKeyDown={(event) => fieldKeyDown(event, "fee")}
                autoFocus
                className="field-input border-brand/40 bg-sky-50/50 py-1 pr-7 text-xs font-semibold tabular-nums ring-2 ring-brand/10 dark:bg-sky-950/20"
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-neutral-400">%</span>
            </div>
          ) : (
            <button type="button" disabled={!canInlineEdit || busy} onClick={() => setEditingField("fee")} className="mt-0.5 block rounded border border-sky-200/80 bg-sky-50/40 px-1.5 py-0.5 text-left font-medium text-neutral-800 transition-colors enabled:hover:border-brand/40 enabled:hover:bg-sky-50 disabled:cursor-default disabled:border-transparent disabled:bg-transparent dark:border-sky-800/50 dark:bg-sky-950/20 dark:text-neutral-200 dark:enabled:hover:border-brand/40 tabular-nums text-xs sm:text-sm">
              {formatPercent(savedProposal.feePercent)}
            </button>
          )}
        </div>
        <div className="min-h-[60px] p-1 pt-2 sm:px-2.5 sm:pt-1">
          <span className="block text-[10px] font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">Prazo</span>
          {editingField === "term" ? (
            <div className="relative mt-1">
              <input
                inputMode="numeric"
                value={termInput}
                onChange={(event) => setTermInput(event.target.value.replace(/\D/g, "").slice(0, 3))}
                onBlur={() => saveEdit("term")}
                onKeyDown={(event) => fieldKeyDown(event, "term")}
                autoFocus
                className="field-input border-brand/40 bg-sky-50/50 py-1 pr-12 text-xs font-semibold tabular-nums ring-2 ring-brand/10 dark:bg-sky-950/20"
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-neutral-400">meses</span>
            </div>
          ) : (
            <button type="button" disabled={!canInlineEdit || busy} onClick={() => setEditingField("term")} className="mt-0.5 block rounded border border-sky-200/80 bg-sky-50/40 px-1.5 py-0.5 text-left font-medium text-neutral-800 transition-colors enabled:hover:border-brand/40 enabled:hover:bg-sky-50 disabled:cursor-default disabled:border-transparent disabled:bg-transparent dark:border-sky-800/50 dark:bg-sky-950/20 dark:text-neutral-200 dark:enabled:hover:border-brand/40 tabular-nums text-xs sm:text-sm">
              {savedProposal.termMonths} {savedProposal.termMonths === 1 ? "mês" : "meses"}
            </button>
          )}
        </div>
      </div>

      {editError && (
        <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {editError}
        </p>
      )}

      {/* Meta Auditoria Resumida */}
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-400 dark:text-neutral-500">
        <span>Criada por {savedProposal.createdByName} em {fmtDate(savedProposal.createdAt)}</span>
        <div className="flex items-center gap-2">
          {busy && <span>Salvando...</span>}
          {!busy && savedRecently && <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><Check className="h-3 w-3" /> Salvo</span>}
          {savedProposal.generatedAt && <span>Gerada às {fmtDateTime(savedProposal.generatedAt).split(" ")[1]}</span>}
        </div>
      </div>

      {/* Barra de Ações Aprimorada */}
      {(actions.size > 0 || hasDocument) && (
        <div className="mt-3 pt-3 border-t border-neutral-100 dark:border-neutral-800/80 flex flex-wrap items-center justify-end gap-1.5">
          {busy && <Loader2 className="h-4 w-4 animate-spin text-neutral-400 mr-auto" strokeWidth={2.5} />}
          {!editingField && (
            <>
          {actions.has("generate") && savedProposal.status === "DRAFT" && (
            <button type="button" disabled={busy} onClick={onGenerate} className="btn-primary btn-sm">
              <FileText className="h-3.5 w-3.5" strokeWidth={2} />
              Gerar documento
            </button>
          )}
          {hasDocument && (
            <Link href={`/propostas/${savedProposal.id}`} className={savedProposal.status === "GENERATED" ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>
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
          {actions.has("cancel") && (
            <button type="button" disabled={busy} onClick={() => onConfirm("cancel")} className="btn-ghost btn-sm text-neutral-400 hover:text-red-600">
              <Ban className="h-3.5 w-3.5" strokeWidth={2} />
              Cancelar
            </button>
          )}
          {actions.has("delete") && (
            <button type="button" disabled={busy} onClick={() => onConfirm("delete")} className="btn-ghost btn-sm text-red-500 hover:text-red-700">
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
              Apagar
            </button>
          )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PastRevisionRow({
  p,
  busy,
  onDuplicate,
}: {
  p: ProposalDTO;
  busy: boolean;
  onDuplicate: () => void;
}) {
  const perQuota = creditPerQuota(p.credit, p.quotaCount);
  const hasDocument = p.status !== "DRAFT" && p.status !== "CANCELLED";

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-neutral-200/80 bg-neutral-50/60 px-3 py-2 text-xs dark:border-neutral-800 dark:bg-neutral-900/40">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-neutral-800 dark:text-neutral-200">Revisão {p.revision}</span>
        <span className="text-neutral-300 dark:text-neutral-700">·</span>
        <span className="font-medium text-neutral-700 dark:text-neutral-300 tabular-nums">{formatCurrency(p.credit)}</span>
        <span className="text-neutral-400 tabular-nums text-[11px]">({p.quotaCount}x {formatCurrency(perQuota)})</span>
        <span className="text-neutral-400 tabular-nums text-[11px]">Taxa {formatPercent(p.feePercent)}</span>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_BADGE_STYLE[p.status]}`}>
          {PROPOSAL_STATUS_LABEL[p.status]}
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[11px] text-neutral-400 hidden sm:inline">{fmtDate(p.createdAt)}</span>
        {hasDocument && (
          <Link href={`/propostas/${p.id}`} className="btn-secondary px-2.5 py-1 text-xs">
            <ExternalLink className="h-3 w-3" strokeWidth={2} />
            Ver PDF
          </Link>
        )}
        <button type="button" disabled={busy} onClick={onDuplicate} className="btn-ghost px-2 py-1 text-xs" title="Criar nova a partir desta revisão">
          <Copy className="h-3.5 w-3.5 text-neutral-400" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
