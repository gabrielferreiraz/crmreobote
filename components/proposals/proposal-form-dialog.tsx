"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Calculator, FileText, Info, Loader2, Save, X } from "lucide-react";
import { Modal } from "@/components/modal";
import { CurrencyInput } from "@/components/currency-input";
import { LoadingDots } from "@/components/loading-dots";
import { formatCurrency } from "@/lib/format";
import { proposalApi } from "@/lib/proposals/client";
import { parseProposalFields } from "@/lib/proposals/validate";
import { formatPercent, type ProposalDTO } from "@/lib/proposals/types";

type CreditMode = "TOTAL" | "PER_QUOTA";

const round2 = (n: number) => Math.round(n * 100) / 100;

function parsePercentInput(value: string): number {
  const normalized = value.replace(",", ".").trim();
  if (!normalized) return 0;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

export function ProposalFormDialog({
  dealId,
  proposal,
  defaultDescription,
  onClose,
}: {
  dealId: string;
  proposal: ProposalDTO | null;
  defaultDescription: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const editing = proposal !== null;

  const [mode, setMode] = useState<CreditMode>("TOTAL");
  const [creditInput, setCreditInput] = useState(proposal ? proposal.credit.toFixed(2) : "");
  const [quotaStr, setQuotaStr] = useState(proposal ? String(proposal.quotaCount) : "1");
  const [termStr, setTermStr] = useState(proposal ? String(proposal.termMonths) : "");
  const [feePercent, setFeePercent] = useState(proposal ? proposal.feePercent.toFixed(2) : "");
  const [installment, setInstallment] = useState(proposal ? proposal.installment.toFixed(2) : "");
  const [description, setDescription] = useState(proposal ? proposal.description : defaultDescription);
  const [totalBeforeSwitch, setTotalBeforeSwitch] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState<"save" | "generate" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const quota = Number(quotaStr) || 0;
  const creditNum = Number(creditInput) || 0;
  const total = mode === "TOTAL" ? round2(creditNum) : round2(creditNum * quota);
  const perQuota = mode === "PER_QUOTA" ? creditNum : quota > 0 ? total / quota : 0;
  const inexactNote =
    mode === "PER_QUOTA" && totalBeforeSwitch !== null && total !== totalBeforeSwitch
      ? `A divisão por ${quota} cota${quota === 1 ? "" : "s"} não fecha exata: o total passou de ${formatCurrency(totalBeforeSwitch)} para ${formatCurrency(total)}.`
      : null;

  function switchMode(next: CreditMode) {
    if (next === mode) return;
    if (quota < 1) {
      setError("Informe a quantidade de cotas antes de trocar entre Total e Por cota.");
      return;
    }
    setError(null);
    if (next === "PER_QUOTA") {
      const per = quota > 0 ? round2(total / quota) : 0;
      setTotalBeforeSwitch(total);
      setCreditInput(per ? per.toFixed(2) : "");
    } else {
      setTotalBeforeSwitch(null);
      setCreditInput(total ? total.toFixed(2) : "");
    }
    setMode(next);
  }

  async function submit(thenGenerate: boolean) {
    const parsed = parseProposalFields({
      credit: total,
      termMonths: Number(termStr),
      installment: Number(installment),
      feePercent: parsePercentInput(feePercent),
      quotaCount: quota,
      description,
    });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    setSubmitting(thenGenerate ? "generate" : "save");
    setError(null);

    const saved = editing ? await proposalApi.update(proposal.id, parsed.value) : await proposalApi.create(dealId, parsed.value);
    if (!saved.ok) {
      setSubmitting(null);
      setError(saved.error);
      return;
    }

    if (thenGenerate) {
      const generated = await proposalApi.action(saved.data.id, "generate");
      if (!generated.ok) {
        setSubmitting(null);
        setError(`Proposta salva, mas não foi possível gerar o documento: ${generated.error}`);
        router.refresh();
        return;
      }
      router.push(`/propostas/${saved.data.id}`);
      return;
    }

    router.refresh();
    onClose();
  }

  const busy = submitting !== null;

  return (
    <Modal onClose={onClose} maxWidth="max-w-4xl !max-h-[calc(100vh-1rem)] !overflow-hidden">
      <div className="-m-5 mb-0 border-b border-neutral-200 bg-white/80 px-5 py-3 dark:border-neutral-800 dark:bg-neutral-950/40">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-light text-brand dark:bg-brand-light/20 dark:text-brand-light">
              <FileText className="h-4 w-4" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand dark:text-brand-light">Proposta comercial</p>
              <h2 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
                {editing ? `Editar revisão ${proposal.revision}` : "Nova proposta"}
              </h2>
              <p className="mt-0.5 max-w-2xl text-sm leading-5 text-neutral-500 dark:text-neutral-400">
                Gere a folha A4, salve o PDF pelo navegador e marque como enviada só depois de mandar ao cliente.
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="icon-btn h-8 w-8 shrink-0" aria-label="Fechar">
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </div>

      <div className="grid gap-4 pt-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-3">
          <section className="rounded-lg border border-neutral-200 bg-neutral-50/70 p-3 dark:border-neutral-800 dark:bg-neutral-900/50">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <label className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{mode === "TOTAL" ? "Crédito total" : "Crédito por cota"}</label>
                <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">O valor salvo será sempre o crédito total.</p>
              </div>
              <div className="inline-flex rounded-lg border border-neutral-200 bg-white p-0.5 text-xs shadow-xs dark:border-neutral-800 dark:bg-neutral-950/60" role="group" aria-label="Como informar o crédito">
                {(
                  [
                    { value: "TOTAL", label: "Total" },
                    { value: "PER_QUOTA", label: "Por cota" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => switchMode(opt.value)}
                    className={`min-h-8 rounded-md px-3 font-semibold transition-colors ${
                      mode === opt.value
                        ? "bg-neutral-900 text-white shadow-sm dark:bg-white dark:text-neutral-900"
                        : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <CurrencyInput
              value={creditInput}
              onChange={(v) => {
                setCreditInput(v);
                setTotalBeforeSwitch(null);
              }}
            />
            {inexactNote && (
              <div className="mt-2 flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                <span>{inexactNote} Volte para Total se quiser manter o valor original.</span>
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[0.7fr_0.8fr_0.8fr_minmax(190px,1.55fr)]">
            <div className="space-y-1.5">
              <label className="field-label">Cotas</label>
              <input
                inputMode="numeric"
                value={quotaStr}
                onChange={(e) => setQuotaStr(e.target.value.replace(/\D/g, "").slice(0, 3))}
                className="field-input"
                placeholder="1"
              />
            </div>
            <div className="space-y-1.5">
              <label className="field-label">Prazo</label>
              <input
                inputMode="numeric"
                value={termStr}
                onChange={(e) => setTermStr(e.target.value.replace(/\D/g, "").slice(0, 3))}
                className="field-input"
                placeholder="180 meses"
              />
            </div>
            <div className="space-y-1.5">
              <label className="field-label">Taxa</label>
              <div className="relative">
                <input
                  inputMode="decimal"
                  value={feePercent}
                  onChange={(e) => setFeePercent(e.target.value.replace(/[^\d,.]/g, "").slice(0, 6))}
                  onBlur={() => {
                    const n = parsePercentInput(feePercent);
                    setFeePercent(Number.isFinite(n) && n > 0 ? n.toFixed(2) : "");
                  }}
                  className="field-input pr-8"
                  placeholder="0,00"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-neutral-400 dark:text-neutral-500">
                  %
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="field-label">Parcela</label>
              <CurrencyInput value={installment} onChange={setInstallment} className="font-semibold tabular-nums" />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="field-label">Observações da proposta</label>
              {defaultDescription && description !== defaultDescription && (
                <button
                  type="button"
                  onClick={() => setDescription(defaultDescription)}
                  className="text-xs font-medium text-brand hover:text-neutral-900 dark:text-brand-light dark:hover:text-neutral-100"
                >
                  Usar texto padrão
                </button>
              )}
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              maxLength={4000}
              placeholder="Condições, observações e informações que devem aparecer no PDF"
              className="field-input min-h-28 resize-none"
            />
            <p className="text-right text-xs text-neutral-400 tabular-nums dark:text-neutral-500">{description.length}/4000</p>
          </div>
        </div>

        <aside className="space-y-3">
          <div className="rounded-lg border border-neutral-200 bg-white p-3.5 shadow-xs dark:border-neutral-800 dark:bg-neutral-950/40">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                <Calculator className="h-4 w-4" strokeWidth={2} />
              </span>
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Resumo</p>
            </div>
            <dl className="space-y-2 text-xs">
              <SummaryLine label="Crédito total" value={formatCurrency(total)} strong />
              <SummaryLine label="Por cota" value={quota > 0 ? formatCurrency(perQuota) : "-"} />
              <SummaryLine label="Cotas" value={quotaStr || "-"} />
              <SummaryLine label="Prazo" value={termStr ? `${termStr} meses` : "-"} />
              <SummaryLine label="Taxa" value={formatPercent(parsePercentInput(feePercent) || 0)} />
              <SummaryLine label="Parcela" value={installment ? formatCurrency(Number(installment)) : "-"} strong />
            </dl>
          </div>
          <div className="flex gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs leading-5 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-300">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand dark:text-brand-light" strokeWidth={2} />
            <p>Depois de marcar como enviada, os valores travam. Para alterar, use Refazer.</p>
          </div>
        </aside>
      </div>

      {error && (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="-mx-5 -mb-7 mt-3 flex flex-wrap justify-end gap-2 border-t border-neutral-200 bg-white/75 px-5 py-3 dark:border-neutral-800 dark:bg-neutral-950/30">
        <button type="button" onClick={onClose} disabled={busy} className="btn-ghost">
          Cancelar
        </button>
        <button type="button" onClick={() => submit(false)} disabled={busy} className="btn-secondary">
          {submitting === "save" ? (
            <span className="inline-flex items-center gap-1">
              Salvando
              <LoadingDots />
            </span>
          ) : (
            <>
              <Save className="h-4 w-4" strokeWidth={2} />
              {editing ? "Salvar alterações" : "Salvar rascunho"}
            </>
          )}
        </button>
        <button type="button" onClick={() => submit(true)} disabled={busy} className="btn-primary">
          {submitting === "generate" ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
          ) : (
            <FileText className="h-4 w-4" strokeWidth={2} />
          )}
          {editing ? "Salvar e abrir documento" : "Salvar e gerar documento"}
        </button>
      </div>
    </Modal>
  );
}

function SummaryLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-neutral-500 dark:text-neutral-400">{label}</dt>
      <dd className={`text-right tabular-nums ${strong ? "font-semibold text-neutral-900 dark:text-neutral-100" : "text-neutral-700 dark:text-neutral-300"}`}>
        {value}
      </dd>
    </div>
  );
}
