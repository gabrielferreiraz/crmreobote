"use client";

import { useState } from "react";
import { Modal } from "@/components/modal";
import { Select } from "@/components/select";
import { CurrencyInput } from "@/components/currency-input";
import { LoadingDots } from "@/components/loading-dots";
import { requestJson } from "@/lib/client-request";
import { formatCurrency } from "@/lib/format";
import { addMonths, formatMonthLong } from "@/lib/commissions/engine";
import { Choices, Question } from "./question";

const QUICK_NOTES = ["Bônus", "Diferença da meia parcela", "Estorno", "Correção de valor"];

/**
 * Lançamento avulso em perguntas — pra quem, somar ou descontar, quanto,
 * em que mês, por quê. O motivo é obrigatório porque é o que o consultor lê.
 * Embaixo, a frase do que vai acontecer, pra conferir antes de lançar.
 */
export function AdjustmentDialog({
  members,
  currentMonth,
  defaultMonth,
  defaultBeneficiaryId,
  saleId,
  onClose,
  onSaved,
}: {
  members: { id: string; name: string }[];
  currentMonth: string;
  defaultMonth?: string;
  defaultBeneficiaryId?: string;
  saleId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [beneficiaryId, setBeneficiaryId] = useState(defaultBeneficiaryId ?? "");
  const [month, setMonth] = useState(defaultMonth ?? currentMonth);
  const [direction, setDirection] = useState<"add" | "subtract">("add");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const monthOptions = Array.from({ length: 15 }, (_, i) => addMonths(currentMonth, i - 2)).map((m) => ({ value: m, label: formatMonthLong(m) }));
  const amountNum = Number(amount);
  const canSave = !!beneficiaryId && amountNum > 0 && !!note.trim();
  const personName = members.find((m) => m.id === beneficiaryId)?.name;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const res = await requestJson(
      "/api/commissions/adjustments",
      { method: "POST", json: { beneficiaryId, month, amount: direction === "add" ? amountNum : -amountNum, note: note.trim(), saleId } },
      { silent: true },
    );
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onSaved();
  }

  return (
    <Modal onClose={() => !saving && onClose()} maxWidth="max-w-lg">
      <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Lançar ajuste</h2>
      <form onSubmit={submit} className="mt-5 space-y-6">
        <Question title="Para quem">
          <Select value={beneficiaryId} onChange={setBeneficiaryId} options={members.map((m) => ({ value: m.id, label: m.name }))} placeholder="Escolha a pessoa" ariaLabel="Pessoa" />
        </Question>

        <Question title="Tipo">
          <Choices
            value={direction}
            onChange={setDirection}
            options={[
              { value: "add", label: "Somar" },
              { value: "subtract", label: "Descontar" },
            ]}
          />
        </Question>

        <div className="grid gap-6 sm:grid-cols-2">
          <Question title="Valor">
            <CurrencyInput value={amount} onChange={setAmount} />
          </Question>
          <Question title="Mês">
            <Select value={month} onChange={setMonth} options={monthOptions} ariaLabel="Mês" />
          </Question>
        </div>

        <Question title="Motivo (o consultor vê)">
          <div className="flex flex-wrap gap-2">
            {QUICK_NOTES.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setNote(n)}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  note === n
                    ? "border-brand bg-brand-light text-brand"
                    : "border-neutral-200 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <input className="field-input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: bônus da campanha de outubro" aria-label="Motivo" />
        </Question>

        {personName && amountNum > 0 && (
          <p className="rounded-xl bg-brand-light px-4 py-3 text-sm text-neutral-800 dark:text-neutral-200">
            <strong className="font-semibold">
              {direction === "add" ? "+" : "−"} {formatCurrency(amountNum)}
            </strong>{" "}
            para {personName} em {formatMonthLong(month).toLowerCase()}
          </p>
        )}

        {error && <p className="field-error text-sm">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={saving || !canSave}>
            {saving ? <LoadingDots /> : "Lançar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
