"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Calculator, FileText, Info, Loader2, Save } from "lucide-react";
import { Modal } from "@/components/modal";
import { CurrencyInput } from "@/components/currency-input";
import { LoadingDots } from "@/components/loading-dots";
import { formatCurrency } from "@/lib/format";
import { proposalApi } from "@/lib/proposals/client";
import { parseProposalFields } from "@/lib/proposals/validate";
import type { ProposalDTO } from "@/lib/proposals/types";

type CreditMode = "TOTAL" | "PER_QUOTA";

const round2 = (n: number) => Math.round(n * 100) / 100;

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
    <Modal onClose={onClose} maxWidth="max-w-2xl">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand dark:bg-brand/15">
          <FileText className="h-5 w-5" strokeWidth={2} />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            {editing ? `Editar proposta - revisão ${proposal.revision}` : "Nova proposta"}
          </h2>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Salvar ou gerar o documento não marca como enviada. O envio é um passo separado depois do PDF sair.
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="space-y-4">
          <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <label className="field-label">{mode === "TOTAL" ? "Crédito total" : "Crédito por cota"}</label>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">O sistema sempre guarda o total.</p>
              </div>
              <div className="inline-flex rounded-md bg-neutral-100 p-0.5 text-xs dark:bg-neutral-800" role="group" aria-label="Como informar o crédito">
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
                    className={`rounded px-2.5 py-1 font-medium transition-colors ${
                      mode === opt.value
                        ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100"
                        : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
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
              <div className="mt-2 flex gap-1.5 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                <span>{inexactNote} Volte para Total se quiser manter o valor original.</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="field-label">Quantidade de cotas</label>
              <input
                inputMode="numeric"
                value={quotaStr}
                onChange={(e) => setQuotaStr(e.target.value.replace(/\D/g, "").slice(0, 3))}
                className="field-input"
                placeholder="1"
              />
            </div>
            <div className="space-y-1">
              <label className="field-label">Prazo (meses)</label>
              <input
                inputMode="numeric"
                value={termStr}
                onChange={(e) => setTermStr(e.target.value.replace(/\D/g, "").slice(0, 3))}
                className="field-input"
                placeholder="180"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="field-label">Parcela</label>
            <CurrencyInput value={installment} onChange={setInstallment} />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <label className="field-label">Descrição</label>
              {defaultDescription && description !== defaultDescription && (
                <button
                  type="button"
                  onClick={() => setDescription(defaultDescription)}
                  className="text-xs text-neutral-500 underline hover:text-neutral-800 dark:hover:text-neutral-200"
                >
                  Usar texto padrão
                </button>
              )}
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={7}
              maxLength={4000}
              placeholder="Condições, observações e o que mais aparecer na proposta"
              className="field-input"
            />
            <p className="text-right text-xs text-neutral-400 tabular-nums dark:text-neutral-500">{description.length}/4000</p>
          </div>
        </div>

        <aside className="space-y-3">
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/60">
            <div className="mb-2 flex items-center gap-2">
              <Calculator className="h-4 w-4 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Resumo</p>
            </div>
            <dl className="space-y-2 text-xs">
              <SummaryLine label="Crédito total" value={formatCurrency(total)} strong />
              <SummaryLine label="Por cota" value={quota > 0 ? formatCurrency(perQuota) : "-"} />
              <SummaryLine label="Cotas" value={quotaStr || "-"} />
              <SummaryLine label="Prazo" value={termStr ? `${termStr} meses` : "-"} />
              <SummaryLine label="Parcela" value={installment ? formatCurrency(Number(installment)) : "-"} strong />
            </dl>
          </div>
          <div className="flex gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300">
            <Info className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
            <p>Depois de marcar como enviada, estes valores travam. Para alterar, use Refazer e crie uma nova revisão.</p>
          </div>
        </aside>
      </div>

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-5 flex flex-wrap justify-end gap-2">
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
