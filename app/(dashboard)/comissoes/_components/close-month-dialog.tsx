"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Download } from "lucide-react";
import { Modal } from "@/components/modal";
import { LoadingDots } from "@/components/loading-dots";
import { useUndoToast } from "@/components/undo-provider";
import { requestJson } from "@/lib/client-request";
import { formatCurrency } from "@/lib/format";
import { formatMonthLong } from "@/lib/commissions/engine";
import type { EntryView } from "@/lib/commissions/queries";

type Step = "held" | "review" | "done";

/**
 * "Fechar o mês" — o pagamento do dia 10 como um passo a passo, em vez de
 * um botão "Pagar tudo" solto: 1) o que fica de fora (travadas), 2) quanto
 * cada pessoa recebe, 3) pagar, 4) baixar a planilha pro banco. No fim, um
 * resumo do que foi fechado. O pagamento devolve Ctrl+Z, como qualquer outro.
 */
export function CloseMonthDialog({ month, entries, onClose }: { month: string; entries: EntryView[]; onClose: () => void }) {
  const router = useRouter();
  const pushUndoToast = useUndoToast();
  const held = entries.filter((e) => e.status === "ON_HOLD");
  const disputed = entries.filter((e) => e.dispute?.status === "OPEN" && e.status === "SCHEDULED");
  const toPay = entries.filter((e) => e.status === "SCHEDULED" && !e.paidByAdministrator);
  const [step, setStep] = useState<Step>(held.length > 0 || disputed.length > 0 ? "held" : "review");
  const [paying, setPaying] = useState(false);
  const [result, setResult] = useState<{ total: number; people: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const monthName = formatMonthLong(month, { withYear: false }).toLowerCase();

  const byPerson = Array.from(
    toPay
      .reduce((map, e) => {
        const row = map.get(e.beneficiaryId) ?? { name: e.beneficiaryName, total: 0, count: 0 };
        row.total += e.amount;
        row.count += 1;
        return map.set(e.beneficiaryId, row);
      }, new Map<string, { name: string; total: number; count: number }>())
      .values(),
  ).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const total = toPay.reduce((acc, e) => acc + e.amount, 0);

  async function pay() {
    setPaying(true);
    setError(null);
    const res = await requestJson<{ paid: number; total: number; people: number; undo?: { id: string; description: string } }>(
      "/api/commissions/entries/pay-month",
      { method: "POST", json: { month } },
      { silent: true },
    );
    setPaying(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setResult({ total: res.data.total, people: res.data.people ?? byPerson.length });
    pushUndoToast(res.data.undo);
    setStep("done");
    router.refresh();
  }

  return (
    <Modal onClose={() => !paying && onClose()} maxWidth="max-w-lg">
      <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Fechar {formatMonthLong(month).toLowerCase()}</h2>

      {step === "held" && (
        <div className="mt-4 space-y-4">
          {held.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {held.length} {held.length === 1 ? "parcela está travada e fica" : "parcelas estão travadas e ficam"} de fora deste pagamento:
              </p>
              <ul className="max-h-48 space-y-1.5 overflow-y-auto rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
                {held.map((e) => (
                  <li key={e.id}>
                    <strong className="font-semibold">{e.beneficiaryName}</strong>, {e.clientName ?? "ajuste"}: {e.holdReason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {disputed.length > 0 && (
            <p className="flex items-start gap-2 text-sm text-neutral-700 dark:text-neutral-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" strokeWidth={2} />
              {disputed.length} {disputed.length === 1 ? "parcela foi contestada" : "parcelas foram contestadas"} e ainda não {disputed.length === 1 ? "tem" : "têm"} resposta. Se quiser
              conferir antes, feche esta janela e responda as contestações.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancelar
            </button>
            <button type="button" className="btn-primary" onClick={() => setStep("review")}>
              Continuar
            </button>
          </div>
        </div>
      )}

      {step === "review" && (
        <div className="mt-4 space-y-4">
          {byPerson.length === 0 ? (
            <p className="text-sm text-neutral-700 dark:text-neutral-300">Não há nada pronto para pagar em {monthName}.</p>
          ) : (
            <>
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Confira quanto cada pessoa recebe em {monthName}:</p>
              <ul className="max-h-72 divide-y divide-neutral-100 overflow-y-auto rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
                {byPerson.map((p) => (
                  <li key={p.name} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="truncate text-neutral-800 dark:text-neutral-200">{p.name}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{formatCurrency(p.total)}</span>
                  </li>
                ))}
              </ul>
              <p className="flex items-center justify-between text-base font-semibold text-neutral-900 dark:text-neutral-100">
                <span>Total para {byPerson.length} {byPerson.length === 1 ? "pessoa" : "pessoas"}</span>
                <span className="tabular-nums">{formatCurrency(total)}</span>
              </p>
            </>
          )}
          {error && <p className="field-error text-sm">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose} disabled={paying}>
              Cancelar
            </button>
            {byPerson.length > 0 && (
              <button type="button" className="btn-primary" onClick={pay} disabled={paying}>
                {paying ? <LoadingDots /> : `Marcar ${formatCurrency(total)} como pago`}
              </button>
            )}
          </div>
        </div>
      )}

      {step === "done" && result && (
        <div className="mt-4 space-y-4">
          <div className="flex items-start gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-100">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={2} />
            <p className="text-sm">
              <strong className="font-semibold">{formatMonthLong(month)} fechado:</strong> {formatCurrency(result.total)} para {result.people}{" "}
              {result.people === 1 ? "pessoa" : "pessoas"}. Cada um recebeu um aviso no celular.
            </p>
          </div>
          <p className="text-sm text-neutral-700 dark:text-neutral-300">Agora baixe a planilha para fazer o pagamento no banco ou na folha.</p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Fechar
            </button>
            <a href={`/api/commissions/export?month=${month}&what=paid`} className="btn-primary">
              <Download className="h-4 w-4" strokeWidth={2} />
              Baixar planilha
            </a>
          </div>
        </div>
      )}
    </Modal>
  );
}
