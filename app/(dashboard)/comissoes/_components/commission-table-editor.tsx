"use client";

import { CircleAlert } from "lucide-react";
import { formatPercent, revenueConfigError, type CommissionTableLike, type RevenueMode } from "@/lib/commissions/engine";
import { Choices, Question } from "./question";
import { parseWholeNumber, WholeNumberInput } from "./whole-number-input";

const COMMON_COUNTS = ["1", "4", "6", "10", "12"];
export type RevenueChoice = RevenueMode | "none";

/**
 * O que a pessoa está digitando numa tabela — TEXTO, do jeito que foi
 * digitado (pode ficar vazio enquanto apaga), nunca número já corrigido
 * (ver WholeNumberInput). Vira CommissionTableLike só na hora de salvar.
 */
export type TableDraft = {
  creditType: string | null;
  countChoice: string;
  countText: string;
  /** Último número de parcelas VÁLIDO — a tela não "pula" enquanto o campo está vazio. */
  count: number;
  hasSkipped: boolean;
  skipped: number[];
  revenueChoice: RevenueChoice;
  totalText: string;
  tableText: string[];
  revenueBase: "NET" | "GROSS";
};

/** "1,5" / "1.5" → 1.5; vazio/inválido → null. */
export function parseDecimal(text: string): number | null {
  const n = Number(text.replace(",", ".").trim());
  return text.trim() !== "" && Number.isFinite(n) ? n : null;
}
const toText = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","));

export function draftFromTable(table: CommissionTableLike | null, creditType: string | null): TableDraft {
  const count = table?.commissionInstallments ?? 1;
  return {
    creditType,
    countChoice: COMMON_COUNTS.includes(String(count)) ? String(count) : "other",
    countText: String(count),
    count,
    hasSkipped: (table?.skippedInstallments.length ?? 0) > 0,
    skipped: table?.skippedInstallments ?? [],
    revenueChoice: table?.revenueMode ?? "none",
    totalText: toText(table?.revenueTotalPercent),
    tableText: table?.revenuePercents?.map(toText) ?? Array.from({ length: count }, () => ""),
    revenueBase: table?.revenueBase ?? "NET",
  };
}

function parts(d: TableDraft) {
  const skipped = d.hasSkipped ? d.skipped.filter((n) => n <= d.count) : [];
  const mode: RevenueMode | null = d.revenueChoice === "none" ? null : d.revenueChoice;
  const total = parseDecimal(d.totalText);
  const percents = Array.from({ length: d.count }, (_, i) => (skipped.includes(i + 1) ? 0 : (parseDecimal(d.tableText[i] ?? "") ?? 0)));
  const anyTyped = d.tableText.slice(0, d.count).some((t, i) => !skipped.includes(i + 1) && t.trim() !== "");
  return { skipped, mode, total, percents, anyTyped };
}

/** O que impede salvar esta tabela (frase de tela), ou null. */
export function draftError(d: TableDraft): string | null {
  if (d.countChoice === "other" && parseWholeNumber(d.countText, 1, 60) == null) return "De 1 a 60 vezes.";
  const { skipped, mode, total, percents, anyTyped } = parts(d);
  if (skipped.length >= d.count) return "Ao menos uma parcela com comissão.";
  if (mode === "CREDIT_EQUAL" && d.totalText.trim() === "") return "Digite quanto ela paga no total.";
  if ((mode === "CREDIT_TABLE" || mode === "CLIENT_INSTALLMENT_TABLE") && !anyTyped) return "Preencha o % das parcelas.";
  return revenueConfigError(mode, d.count, mode === "CREDIT_EQUAL" ? total : null, mode === "CREDIT_EQUAL" ? null : percents);
}

/** Rascunho → tabela (pra salvar e pras prévias). */
export function draftToTable(d: TableDraft): CommissionTableLike {
  const { skipped, mode, total, percents } = parts(d);
  return {
    creditType: d.creditType,
    commissionInstallments: d.count,
    skippedInstallments: skipped,
    revenueMode: mode,
    revenueTotalPercent: mode === "CREDIT_EQUAL" ? total : null,
    revenuePercents: mode === "CREDIT_TABLE" || mode === "CLIENT_INSTALLMENT_TABLE" ? percents : null,
    revenueBase: d.revenueBase,
  };
}

/** Campo de % (aceita vírgula), guardando o texto digitado. */
function PercentInput({
  value,
  onChange,
  ariaLabel,
  className = "",
  disabled = false,
  invalid = false,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  return (
    <div className={`relative ${className}`}>
      <input
        inputMode="decimal"
        autoComplete="off"
        className="field-input pr-8 text-right tabular-nums disabled:opacity-50"
        value={disabled ? "" : value}
        placeholder={disabled ? "—" : "0,00"}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ""))}
        onFocus={(e) => e.target.select()}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-neutral-400">%</span>
    </div>
  );
}

/**
 * Uma tabela de comissão em perguntas: em quantas vezes paga, quais
 * parcelas NÃO têm comissão, quanto paga pra corretora (nos três jeitos ou
 * "não informar"). Usada pra tabela padrão e pra cada categoria.
 */
export function CommissionTableEditor({
  draft,
  onChange,
  showValidation = false,
}: {
  draft: TableDraft;
  onChange: (next: TableDraft) => void;
  name: string;
  showValidation?: boolean;
}) {
  const set = (patch: Partial<TableDraft>) => onChange({ ...draft, ...patch });
  const count = draft.count;
  const typedCountInvalid = draft.countChoice === "other" && parseWholeNumber(draft.countText, 1, 60) == null;
  const { skipped, mode, total, percents, anyTyped } = parts(draft);
  const error = draftError(draft);
  const showError = !!error && (typedCountInvalid || anyTyped || draft.totalText.trim() !== "" || skipped.length >= count);
  const tableUnit = mode === "CLIENT_INSTALLMENT_TABLE" ? "da parcela do cliente" : "do crédito";

  return (
    <div className="space-y-6">
      <Question title="Em quantas vezes paga">
        <Choices
          columns={3}
          value={draft.countChoice}
          onChange={(v) => {
            if (v === "other") {
              set({ countChoice: v });
              return;
            }
            const safe = Number(v);
            onChange({
              ...draft,
              countChoice: v,
              countText: v,
              count: safe,
              tableText: Array.from({ length: safe }, (_, i) => draft.tableText[i] ?? ""),
              skipped: draft.skipped.filter((x) => x <= safe),
            });
          }}
          options={[
            { value: "1", label: "1x" },
            { value: "4", label: "4x" },
            { value: "6", label: "6x" },
            { value: "10", label: "10x" },
            { value: "12", label: "12x" },
            { value: "other", label: "Outro" },
          ]}
        />
        {draft.countChoice === "other" && (
          <label className="flex items-center gap-2 pt-1 text-sm text-neutral-700 dark:text-neutral-300">
            Paga em
            <WholeNumberInput
              value={draft.countText}
              onChange={(text) => {
                const n = parseWholeNumber(text, 1, 60);
                if (n == null) set({ countText: text });
                else onChange({ ...draft, countText: text, count: n, tableText: Array.from({ length: n }, (_, i) => draft.tableText[i] ?? ""), skipped: draft.skipped.filter((x) => x <= n) });
              }}
              invalid={typedCountInvalid}
              ariaLabel="Em quantas vezes"
            />
            vezes
          </label>
        )}
      </Question>

      {count > 1 && (
        <Question title="Parcelas sem comissão?">
          <Choices
            value={draft.hasSkipped ? "yes" : "no"}
            onChange={(v) => set({ hasSkipped: v === "yes" })}
            options={[
              { value: "no", label: "Não" },
              { value: "yes", label: "Sim" },
            ]}
          />
          {draft.hasSkipped && (
            <div className="space-y-2 pt-1">
              <p className="text-sm text-neutral-700 dark:text-neutral-300">Toque nas parcelas sem comissão.</p>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: count }, (_, i) => i + 1).map((n) => {
                  const off = skipped.includes(n);
                  return (
                    <button
                      key={n}
                      type="button"
                      aria-pressed={off}
                      onClick={() => set({ skipped: off ? draft.skipped.filter((x) => x !== n) : [...draft.skipped, n].sort((a, b) => a - b) })}
                      className={`min-w-14 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                        off
                          ? "border-neutral-400 bg-neutral-200 text-neutral-500 line-through dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-400"
                          : "border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                      }`}
                    >
                      {n}ª
                    </button>
                  );
                })}
              </div>
              {skipped.length > 0 && (
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  Sem comissão: {skipped.map((n) => `${n}ª`).join(", ")}.
                </p>
              )}
            </div>
          )}
        </Question>
      )}

      <Question title="Quanto paga à corretora">
        <Choices
          value={draft.revenueChoice}
          onChange={(v) => set({ revenueChoice: v })}
          options={[
            { value: "CREDIT_EQUAL", label: "% do crédito, igual" },
            { value: "CREDIT_TABLE", label: "% do crédito por parcela" },
            { value: "CLIENT_INSTALLMENT_TABLE", label: "% da parcela do cliente" },
            { value: "none", label: "Não informar" },
          ]}
        />

        {mode === "CREDIT_EQUAL" && (
          <div className="space-y-1.5 pt-2">
            <label className="flex flex-wrap items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
              No total, ela paga
              <PercentInput
                value={draft.totalText}
                onChange={(v) => set({ totalText: v })}
                ariaLabel="Percentual total do crédito"
                className="w-28"
                invalid={showValidation && (total == null || total <= 0 || total > 100)}
              />
              do crédito.
            </label>
            {total != null && total > 0 && count - skipped.length > 1 && (
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                Isso dá {formatPercent(Math.round((total / (count - skipped.length)) * 10000) / 10000)} em cada uma das {count - skipped.length} parcelas com comissão.
              </p>
            )}
          </div>
        )}

        {(mode === "CREDIT_TABLE" || mode === "CLIENT_INSTALLMENT_TABLE") && (
          <div className="space-y-2 pt-2">
            <p className="text-sm text-neutral-700 dark:text-neutral-300">% {tableUnit} em cada parcela</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Array.from({ length: count }, (_, i) => {
                const off = skipped.includes(i + 1);
                const text = draft.tableText[i] ?? "";
                const typedPercent = parseDecimal(text);
                const maxPercent = mode === "CLIENT_INSTALLMENT_TABLE" ? 1000 : 100;
                const invalidPercent =
                  showValidation &&
                  !off &&
                  ((!anyTyped && text.trim() === "") ||
                    (typedPercent != null && (typedPercent < 0 || typedPercent > maxPercent)));
                return (
                  <label key={i} className="space-y-1">
                    <span className="block text-sm text-neutral-600 dark:text-neutral-400">
                      {i + 1}ª parcela{off ? " (sem comissão)" : ""}
                    </span>
                    <PercentInput
                      value={text}
                      disabled={off}
                      invalid={invalidPercent}
                      onChange={(v) => {
                        const next = [...draft.tableText];
                        next[i] = v;
                        set({ tableText: next });
                      }}
                      ariaLabel={`${i + 1}ª parcela`}
                    />
                  </label>
                );
              })}
            </div>
            {anyTyped && mode === "CREDIT_TABLE" && (
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                No total: {formatPercent(Math.round(percents.reduce((a, b) => a + b, 0) * 10000) / 10000)} do crédito.
              </p>
            )}
          </div>
        )}

        {(mode === "CREDIT_EQUAL" || mode === "CREDIT_TABLE") && (
          <div className="space-y-2 pt-3">
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Sobre o valor</p>
            <Choices
              value={draft.revenueBase}
              onChange={(v) => set({ revenueBase: v })}
              options={[
                { value: "NET", label: "Líquido" },
                { value: "GROSS", label: "Bruto" },
              ]}
            />
          </div>
        )}
        {mode === "CLIENT_INSTALLMENT_TABLE" && (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">Parcela do cliente vem da proposta.</p>
        )}
        {draft.revenueChoice === "none" && (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Sem isso, não aparece o saldo da corretora.
          </p>
        )}
      </Question>

      {error && (
        <p
          className={`flex items-start gap-1.5 text-sm ${
            showValidation || showError
              ? "field-error"
              : "text-amber-700 dark:text-amber-300"
          }`}
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{showValidation || showError ? error : `Falta preencher: ${error}`}</span>
        </p>
      )}
    </div>
  );
}
