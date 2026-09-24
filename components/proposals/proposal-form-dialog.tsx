"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2 } from "lucide-react";
import { Modal } from "@/components/modal";
import { CurrencyInput } from "@/components/currency-input";
import { LoadingDots } from "@/components/loading-dots";
import { formatCurrency } from "@/lib/format";
import { proposalApi } from "@/lib/proposals/client";
import { parseProposalFields } from "@/lib/proposals/validate";
import type { ProposalDTO } from "@/lib/proposals/types";

type CreditMode = "TOTAL" | "PER_QUOTA";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Criar/editar uma proposta (DRAFT ou GENERATED — depois de enviada os campos
 * travam, ver isProposalEditable em lib/proposals/types.ts).
 *
 * Crédito: o consultor escolhe na hora se digita o TOTAL ou o valor POR COTA
 * (decisão do usuário: depende do caso). O que vai pro servidor é SEMPRE o
 * total — o modo é só de digitação; "por cota" nunca é guardado (ver
 * Proposal.credit no schema). Trocar de modo mantém o valor de crédito real:
 * o campo digitável passa a ser o outro, já convertido.
 *
 * Ressalva do arredondamento: 100.000 ÷ 3 cotas = 33.333,33 por cota, e
 * 33.333,33 × 3 = 99.999,99 — um centavo a menos que o total digitado. Como
 * isto vira documento comercial impresso, a troca de modo NUNCA muda o total
 * em silêncio: quando a divisão não fecha exata, aparece um aviso dizendo de
 * quanto pra quanto o total passou.
 */
export function ProposalFormDialog({
  dealId,
  proposal,
  defaultDescription,
  onClose,
}: {
  dealId: string;
  /** null = proposta nova; preenchida = editando (DRAFT/GENERATED). */
  proposal: ProposalDTO | null;
  /** Texto padrão da organização — só pré-preenche a descrição de proposta NOVA, nunca sobrescreve a de uma existente. */
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
  // Total de ANTES da troca TOTAL→POR COTA, só pra poder avisar se a
  // divisão não fechou exata (null = nada a avisar).
  const [totalBeforeSwitch, setTotalBeforeSwitch] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState<"save" | "generate" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const quota = Number(quotaStr) || 0;
  const creditNum = Number(creditInput) || 0;
  const total = mode === "TOTAL" ? round2(creditNum) : round2(creditNum * quota);
  const perQuota = mode === "PER_QUOTA" ? creditNum : quota > 0 ? total / quota : 0;
  const inexactNote =
    mode === "PER_QUOTA" && totalBeforeSwitch !== null && total !== totalBeforeSwitch
      ? `A divisão por ${quota} cota${quota === 1 ? "" : "s"} não fecha exata: o total passou de ${formatCurrency(totalBeforeSwitch)} para ${formatCurrency(total)}. Volte pra "Total" se quiser manter o valor original.`
      : null;

  function switchMode(next: CreditMode) {
    if (next === mode) return;
    // Sem quantidade de cotas válida não há como converter — trocar mesmo
    // assim zeraria o valor digitado (total ÷ 0) e a volta não recuperaria.
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
      // Idempotente em GENERATED (ver generateProposal) — pode chamar sempre.
      const generated = await proposalApi.action(saved.data.id, "generate");
      if (!generated.ok) {
        // A proposta FOI salva (só a geração falhou) — fecha e deixa o
        // consultor tentar "Gerar documento" de novo pelo cartão, em vez de
        // segurar o diálogo aberto com o formulário já gravado.
        setSubmitting(null);
        setError(`Proposta salva, mas não foi possível gerar o documento: ${generated.error}`);
        router.refresh();
        return;
      }
      // Mesma aba (não window.open): depois de vários awaits o navegador
      // trata window.open como popup não solicitado e bloqueia.
      router.push(`/propostas/${saved.data.id}`);
      return;
    }

    router.refresh();
    onClose();
  }

  const busy = submitting !== null;

  return (
    <Modal onClose={onClose} maxWidth="max-w-lg">
      <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        {editing ? `Editar proposta (revisão ${proposal.revision})` : "Nova proposta"}
      </h2>

      <div className="space-y-3">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <label className="field-label">{mode === "TOTAL" ? "Crédito total" : "Crédito por cota"}</label>
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

        {/* O outro lado da conta sempre visível — o consultor confere o que
            realmente vai pro documento sem fazer conta de cabeça. */}
        <p className="rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-600 dark:bg-neutral-800/60 dark:text-neutral-300">
          Crédito total <strong className="tabular-nums">{formatCurrency(total)}</strong>
          {quota > 1 && (
            <>
              {" "}
              · <strong className="tabular-nums">{formatCurrency(perQuota)}</strong> por cota
            </>
          )}
        </p>
        {inexactNote && <p className="text-xs text-amber-600 dark:text-amber-400">{inexactNote}</p>}

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
            rows={5}
            maxLength={4000}
            placeholder="Condições, observações e o que mais aparecer na proposta"
            className="field-input"
          />
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} disabled={busy} className="btn-ghost">
            Cancelar
          </button>
          <button type="button" onClick={() => submit(false)} disabled={busy} className="btn-secondary">
            {submitting === "save" ? (
              <span className="inline-flex items-center gap-1">
                Salvando
                <LoadingDots />
              </span>
            ) : editing ? (
              "Salvar alterações"
            ) : (
              "Salvar rascunho"
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
      </div>
    </Modal>
  );
}
