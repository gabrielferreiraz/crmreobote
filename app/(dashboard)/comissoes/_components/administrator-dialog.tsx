"use client";

import { useState } from "react";
import { Modal } from "@/components/modal";
import { LoadingDots } from "@/components/loading-dots";
import { requestJson } from "@/lib/client-request";
import { formatCurrency } from "@/lib/format";
import {
  addMonths,
  brazilMonthKey,
  buildRevenueSchedule,
  formatMonthLong,
  formatPercent,
  revenueConfigError,
  type RevenueMode,
} from "@/lib/commissions/engine";
import { EXAMPLE_SALE } from "@/lib/commissions/describe";
import { Choices, Question } from "./question";
import { parseWholeNumber, WholeNumberInput } from "./whole-number-input";

export type AdministratorForm = {
  id?: string;
  name: string;
  active: boolean;
  commissionInstallments: number;
  graceMonths: number;
  cutoffDay: number | null;
  paysSellerDirectly: boolean;
  revenueMode: RevenueMode | null;
  revenueTotalPercent: number | null;
  revenuePercents: number[] | null;
  revenueBase: "NET" | "GROSS";
};

export const EMPTY_ADMINISTRATOR: AdministratorForm = {
  name: "",
  active: true,
  commissionInstallments: 1,
  graceMonths: 1,
  cutoffDay: null,
  paysSellerDirectly: false,
  revenueMode: null,
  revenueTotalPercent: null,
  revenuePercents: null,
  revenueBase: "NET",
};

const COMMON_COUNTS = ["1", "4", "6", "10", "12"];
type RevenueChoice = RevenueMode | "none";

/** "1,5" / "1.5" → 1.5; vazio/inválido → null. */
function parseDecimal(text: string): number | null {
  const n = Number(text.replace(",", ".").trim());
  return text.trim() !== "" && Number.isFinite(n) ? n : null;
}
const toText = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","));

/** Campo de % (aceita vírgula), guardando o texto digitado — mesmo motivo do WholeNumberInput. */
function PercentInput({ value, onChange, ariaLabel, className = "" }: { value: string; onChange: (v: string) => void; ariaLabel: string; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <input
        inputMode="decimal"
        autoComplete="off"
        className="field-input pr-8 text-right tabular-nums"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ""))}
        onFocus={(e) => e.target.select()}
        aria-label={ariaLabel}
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-neutral-400">%</span>
    </div>
  );
}

/**
 * Cadastro de administradora como uma conversa: cada campo é uma pergunta
 * e as respostas são botões. A pergunta central é "quanto ela paga para a
 * corretora" — cada administradora paga de um jeito, então aceita os três
 * (% do crédito em partes iguais, tabela de % do crédito por parcela, % da
 * parcela do cliente) ou "não informar agora". Nada de "somar 100%": a
 * pessoa digita a tabela da administradora como ela vem. No fim, o
 * resultado numa venda de exemplo, em reais.
 */
export function AdministratorDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: AdministratorForm;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [countChoice, setCountChoice] = useState(
    COMMON_COUNTS.includes(String(initial.commissionInstallments)) ? String(initial.commissionInstallments) : "other",
  );
  // Texto dos campos de número, do jeito que a pessoa digitou (pode ficar
  // vazio enquanto ela apaga) — ver WholeNumberInput.
  const [countText, setCountText] = useState(String(initial.commissionInstallments));
  const [hasCutoff, setHasCutoff] = useState(initial.cutoffDay != null);
  const [cutoffText, setCutoffText] = useState(String(initial.cutoffDay ?? 25));
  const [revenueChoice, setRevenueChoice] = useState<RevenueChoice>(initial.revenueMode ?? "none");
  const [totalText, setTotalText] = useState(toText(initial.revenueTotalPercent));
  const [tableText, setTableText] = useState<string[]>(
    initial.revenuePercents?.map(toText) ?? Array.from({ length: initial.commissionInstallments }, () => ""),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typedCount = countChoice === "other" ? parseWholeNumber(countText, 1, 60) : null;
  const countError = countChoice === "other" && typedCount == null ? "Digite em quantas vezes ela paga, de 1 a 60." : null;
  // Enquanto o "Outro número" estiver vazio/inválido, usa o último válido (nada pula na tela).
  const count = Math.max(1, Math.min(60, form.commissionInstallments || 1));
  const cutoffDay = parseWholeNumber(cutoffText, 1, 31);
  const cutoffError = hasCutoff && cutoffDay == null ? "Digite o dia de corte, de 1 a 31." : null;

  const revenueMode: RevenueMode | null = revenueChoice === "none" ? null : revenueChoice;
  const totalPercent = parseDecimal(totalText);
  const tablePercents = Array.from({ length: count }, (_, i) => parseDecimal(tableText[i] ?? "") ?? 0);
  const anyTableTyped = tableText.slice(0, count).some((t) => t.trim() !== "");
  const revenueError =
    revenueMode === "CREDIT_EQUAL" && totalText.trim() === ""
      ? "Digite quanto ela paga no total."
      : (revenueMode === "CREDIT_TABLE" || revenueMode === "CLIENT_INSTALLMENT_TABLE") && !anyTableTyped
        ? "Preencha o percentual de cada parcela (pode deixar 0 onde ela não paga)."
        : revenueConfigError(revenueMode, count, totalPercent, revenueMode === "CREDIT_EQUAL" ? null : tablePercents);

  const firstMonth = addMonths(brazilMonthKey(), form.graceMonths);
  const lastMonth = addMonths(firstMonth, count - 1);
  const example =
    revenueMode && !revenueError
      ? buildRevenueSchedule(
          { saleDate: new Date(), netValue: EXAMPLE_SALE.value, grossValue: EXAMPLE_SALE.value, clientInstallment: EXAMPLE_SALE.clientInstallment },
          {
            id: "preview",
            commissionInstallments: count,
            graceMonths: form.graceMonths,
            cutoffDay: null,
            paysSellerDirectly: form.paysSellerDirectly,
            revenueMode,
            revenueTotalPercent: totalPercent,
            revenuePercents: tablePercents,
            revenueBase: form.revenueBase,
          },
        ).installments.reduce((acc, r) => acc + r.amountCents, 0) / 100
      : null;

  function setCount(n: number) {
    const safe = Math.max(1, Math.min(60, n || 1));
    setForm((f) => ({ ...f, commissionInstallments: safe }));
    setTableText((prev) => Array.from({ length: safe }, (_, i) => prev[i] ?? ""));
  }

  const blocked = !form.name.trim() || !!countError || !!cutoffError || !!revenueError;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (blocked) return;
    setSaving(true);
    setError(null);
    const res = await requestJson(
      initial.id ? `/api/commissions/administrators/${initial.id}` : "/api/commissions/administrators",
      {
        method: initial.id ? "PATCH" : "POST",
        json: {
          name: form.name.trim(),
          active: form.active,
          commissionInstallments: count,
          graceMonths: form.graceMonths,
          cutoffDay: hasCutoff ? cutoffDay : null,
          paysSellerDirectly: form.paysSellerDirectly,
          revenueMode,
          revenueTotalPercent: revenueMode === "CREDIT_EQUAL" ? totalPercent : null,
          revenuePercents: revenueMode === "CREDIT_TABLE" || revenueMode === "CLIENT_INSTALLMENT_TABLE" ? tablePercents : null,
          revenueBase: form.revenueBase,
        },
      },
      { silent: true },
    );
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onSaved();
  }

  const name = form.name.trim() || "a administradora";
  const tableUnit = revenueMode === "CLIENT_INSTALLMENT_TABLE" ? "da parcela do cliente" : "do crédito";
  const tableTotal = tablePercents.reduce((a, b) => a + b, 0);

  return (
    <Modal onClose={() => !saving && onClose()} maxWidth="max-w-xl">
      <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{initial.id ? `Editar ${initial.name}` : "Cadastrar administradora"}</h2>
      <form onSubmit={submit} className="mt-5 space-y-7">
        <Question title="Qual é o nome da administradora?">
          <input
            className="field-input text-base"
            value={form.name}
            maxLength={80}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Ex.: Servopa"
            autoFocus
            aria-label="Nome da administradora"
          />
        </Question>

        <Question title={`Em quantas vezes ${name} paga a comissão?`}>
          <Choices
            columns={3}
            value={countChoice}
            onChange={(v) => {
              setCountChoice(v);
              if (v !== "other") {
                setCount(Number(v));
                setCountText(v);
              }
            }}
            options={[
              { value: "1", label: "De uma vez" },
              { value: "4", label: "4 vezes" },
              { value: "6", label: "6 vezes" },
              { value: "10", label: "10 vezes" },
              { value: "12", label: "12 vezes" },
              { value: "other", label: "Outro número" },
            ]}
          />
          {countChoice === "other" && (
            <div className="space-y-1.5 pt-1">
              <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                Paga em
                <WholeNumberInput
                  value={countText}
                  onChange={(text) => {
                    setCountText(text);
                    const n = parseWholeNumber(text, 1, 60);
                    if (n != null) setCount(n);
                  }}
                  invalid={!!countError}
                  ariaLabel="Em quantas vezes"
                  autoFocus
                />
                vezes
              </label>
              {countError && <p className="field-error text-sm">{countError}</p>}
            </div>
          )}
        </Question>

        <Question title={`Quanto ${name} paga para a corretora?`}>
          <Choices
            value={revenueChoice}
            onChange={setRevenueChoice}
            options={[
              { value: "CREDIT_EQUAL", label: "Um % do crédito, em partes iguais" },
              { value: "CREDIT_TABLE", label: "Um % do crédito diferente em cada parcela" },
              { value: "CLIENT_INSTALLMENT_TABLE", label: "Um % da parcela que o cliente paga" },
              { value: "none", label: "Prefiro não informar agora" },
            ]}
          />

          {revenueMode === "CREDIT_EQUAL" && (
            <div className="space-y-1.5 pt-2">
              <label className="flex flex-wrap items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                No total, ela paga
                <PercentInput value={totalText} onChange={setTotalText} ariaLabel="Percentual total do crédito" className="w-28" />
                do crédito.
              </label>
              {totalPercent != null && totalPercent > 0 && count > 1 && (
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  Isso dá {formatPercent(Math.round((totalPercent / count) * 10000) / 10000)} em cada uma das {count} parcelas.
                </p>
              )}
            </div>
          )}

          {(revenueMode === "CREDIT_TABLE" || revenueMode === "CLIENT_INSTALLMENT_TABLE") && (
            <div className="space-y-2 pt-2">
              <p className="text-sm text-neutral-700 dark:text-neutral-300">
                Digite a tabela como ela vem da administradora: quanto ela paga em cada parcela, em % {tableUnit}.
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {Array.from({ length: count }, (_, i) => (
                  <label key={i} className="space-y-1">
                    <span className="block text-sm text-neutral-600 dark:text-neutral-400">{i + 1}ª parcela</span>
                    <PercentInput
                      value={tableText[i] ?? ""}
                      onChange={(v) =>
                        setTableText((prev) => {
                          const next = [...prev];
                          next[i] = v;
                          return next;
                        })
                      }
                      ariaLabel={`${i + 1}ª parcela`}
                    />
                  </label>
                ))}
              </div>
              {anyTableTyped && revenueMode === "CREDIT_TABLE" && (
                <p className="text-sm text-neutral-600 dark:text-neutral-400">No total: {formatPercent(Math.round(tableTotal * 10000) / 10000)} do crédito.</p>
              )}
            </div>
          )}

          {(revenueMode === "CREDIT_EQUAL" || revenueMode === "CREDIT_TABLE") && (
            <div className="space-y-2 pt-3">
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Esse % é sobre qual valor da venda?</p>
              <Choices
                value={form.revenueBase}
                onChange={(v) => setForm((f) => ({ ...f, revenueBase: v }))}
                options={[
                  { value: "NET", label: "Valor líquido" },
                  { value: "GROSS", label: "Valor bruto" },
                ]}
              />
            </div>
          )}

          {revenueMode === "CLIENT_INSTALLMENT_TABLE" && (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              O valor da parcela do cliente vem da proposta do negócio. Sem proposta, o Financeiro preenche na venda.
            </p>
          )}
          {revenueChoice === "none" && (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              Sem isso, a comissão por % da venda funciona normalmente, mas o sistema não mostra quanto fica para a corretora.
            </p>
          )}
          {revenueError && (anyTableTyped || totalText.trim() !== "") && <p className="field-error text-sm">{revenueError}</p>}
        </Question>

        <Question title="Quando sai a primeira parcela?">
          <Choices
            columns={2}
            value={String(Math.min(form.graceMonths, 3))}
            onChange={(v) => setForm((f) => ({ ...f, graceMonths: Number(v) }))}
            options={[
              { value: "0", label: "No mesmo mês da venda" },
              { value: "1", label: "No mês seguinte" },
              { value: "2", label: "2 meses depois" },
              { value: "3", label: "3 meses depois" },
            ]}
          />
        </Question>

        <Question title="Venda no fim do mês conta para o mês seguinte?">
          <Choices
            value={hasCutoff ? "yes" : "no"}
            onChange={(v) => setHasCutoff(v === "yes")}
            options={[
              { value: "no", label: "Não, vale o mês da venda" },
              { value: "yes", label: "Sim, tem dia de corte" },
            ]}
          />
          {hasCutoff && (
            <div className="space-y-1.5 pt-1">
              <label className="flex flex-wrap items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                Venda depois do dia
                <WholeNumberInput value={cutoffText} onChange={setCutoffText} invalid={!!cutoffError} ariaLabel="Dia de corte" />
                conta para o mês seguinte.
              </label>
              {cutoffError && <p className="field-error text-sm">{cutoffError}</p>}
            </div>
          )}
        </Question>

        <Question title="Quem paga a comissão do consultor?">
          <Choices
            value={form.paysSellerDirectly ? "adm" : "company"}
            onChange={(v) => setForm((f) => ({ ...f, paysSellerDirectly: v === "adm" }))}
            options={[
              { value: "company", label: "A nossa empresa" },
              { value: "adm", label: "A administradora, direto" },
            ]}
          />
        </Question>

        {initial.id && (
          <Question title="Vocês ainda vendem essa administradora?">
            <Choices
              value={form.active ? "yes" : "no"}
              onChange={(v) => setForm((f) => ({ ...f, active: v === "yes" }))}
              options={[
                { value: "yes", label: "Sim" },
                { value: "no", label: "Não, tirar da lista do Ganho" },
              ]}
            />
          </Question>
        )}

        <div className="space-y-1 rounded-xl bg-brand-light px-4 py-3 text-sm text-neutral-800 dark:text-neutral-200">
          <p>
            <strong className="font-semibold">Na prática:</strong>{" "}
            {example != null ? (
              <>
                {revenueMode === "CLIENT_INSTALLMENT_TABLE"
                  ? `numa venda com parcela de ${formatCurrency(EXAMPLE_SALE.clientInstallment)} fechada hoje`
                  : `numa venda de ${formatCurrency(EXAMPLE_SALE.value)} fechada hoje`}
                , {name} paga <strong>{formatCurrency(example)}</strong> para a corretora
              </>
            ) : (
              <>numa venda fechada hoje, a comissão é paga</>
            )}
            {count === 1 ? (
              <>
                {" "}
                em <strong>{formatMonthLong(firstMonth)}</strong>.
              </>
            ) : (
              <>
                {" "}
                em <strong>{count} parcelas</strong>, de <strong>{formatMonthLong(firstMonth)}</strong> até <strong>{formatMonthLong(lastMonth)}</strong>.
              </>
            )}
          </p>
          <p>
            {form.paysSellerDirectly ? "A parte do consultor é paga direto pela administradora." : "A empresa paga o consultor no mesmo ritmo em que recebe."} Quanto
            cada um ganha você define no passo 2.
          </p>
        </div>

        {error && <p className="field-error text-sm">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={saving || blocked}>
            {saving ? <LoadingDots /> : "Salvar administradora"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
