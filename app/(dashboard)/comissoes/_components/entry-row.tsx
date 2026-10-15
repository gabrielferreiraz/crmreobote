"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, Lock, LockOpen, MessageCircleQuestion, Trash2, Undo2 } from "lucide-react";
import { Badge } from "@/components/badge";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useUndoToast } from "@/components/undo-provider";
import { requestJson } from "@/lib/client-request";
import { formatCurrency } from "@/lib/format";
import { entryDescription, entryDisplayStatus, PAID_BY_ADMINISTRATOR_LABEL } from "@/lib/commissions/ui";
import type { EntryView } from "@/lib/commissions/queries";
import { HoldDialog } from "./hold-dialog";

/**
 * Uma parcela na tela do Financeiro: em cima QUEM/O QUÊ, embaixo uma frase
 * ("Servopa, parcela 3 de 10, como supervisor."), à direita o valor, o
 * status e só as ações que fazem sentido no status em que ela está — nunca
 * um botão que devolveria erro: a receber → Pagar / Travar; travada →
 * Destravar; paga → Desfazer pagamento.
 *
 * Pagar e desfazer acontecem NA HORA, sem "Tem certeza?": o aviso de
 * Desfazer (Ctrl+Z, canto inferior direito) cobre o engano com um clique.
 */
export function EntryRow({
  entry,
  currentMonth,
  show,
  onChanged,
}: {
  entry: EntryView;
  currentMonth: string;
  /** O que vai no título: o cliente (lista por pessoa, no mês) ou a pessoa (painel da venda). */
  show: "client" | "person";
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pushUndoToast = useUndoToast();
  const status = entryDisplayStatus(entry, currentMonth, "manager");

  async function run(action: "pay" | "unpay" | "release" | "hold", body?: unknown): Promise<string | null> {
    setBusy(true);
    const res = await requestJson(`/api/commissions/entries/${entry.id}/${action}`, { method: "POST", json: body ?? {} }, { silent: action === "hold" });
    setBusy(false);
    if (!res.ok) return res.error;
    pushUndoToast(res.data?.undo);
    onChanged();
    return null;
  }

  async function remove() {
    setBusy(true);
    const res = await requestJson(`/api/commissions/entries/${entry.id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) onChanged();
  }

  const isAdjustment = entry.kind === "ADJUSTMENT";
  const title = show === "person" ? entry.beneficiaryName : isAdjustment ? (entry.note ?? "Ajuste") : (entry.clientName ?? "Venda");
  const description =
    show === "person"
      ? entryDescription(entry, { withMonth: true })
      : entryDescription(entry, { withAdministrator: true, withClient: isAdjustment });

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {show === "client" && entry.saleId ? (
            <Link href={`/comissoes/vendas?venda=${entry.saleId}`} className="hover:underline">
              {title}
            </Link>
          ) : (
            title
          )}
        </p>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {show === "person" && isAdjustment && entry.note ? `${entry.note}. ` : ""}
          {description}
        </p>
        {entry.status === "ON_HOLD" && entry.holdReason && (
          <p className="flex items-start gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
            Travada: {entry.holdReason}
          </p>
        )}
        {entry.dispute?.status === "OPEN" && (
          <p className="flex items-start gap-1.5 text-sm font-medium text-red-700 dark:text-red-300">
            <MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
            {entry.beneficiaryName.split(" ")[0]} contestou: “{entry.dispute.message}”
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <div className="flex flex-col items-end gap-1">
          <span className={`text-sm font-semibold tabular-nums ${entry.amount < 0 ? "text-red-600 dark:text-red-400" : "text-neutral-900 dark:text-neutral-100"}`}>
            {formatCurrency(entry.amount)}
          </span>
          {entry.paidByAdministrator && entry.status !== "PAID" ? (
            <Badge tone="slate">{PAID_BY_ADMINISTRATOR_LABEL}</Badge>
          ) : (
            <Badge tone={status.tone}>{status.label}</Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {entry.status === "SCHEDULED" && !entry.paidByAdministrator && (
            <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => run("pay")}>
              <Check className="h-3.5 w-3.5" strokeWidth={2.2} />
              Pagar
            </button>
          )}
          {entry.status === "SCHEDULED" && (
            <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => setHoldOpen(true)}>
              <Lock className="h-3.5 w-3.5" strokeWidth={2} />
              Travar
            </button>
          )}
          {entry.status === "ON_HOLD" && (
            <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => run("release")}>
              <LockOpen className="h-3.5 w-3.5" strokeWidth={2} />
              Destravar
            </button>
          )}
          {entry.status === "PAID" && (
            <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => run("unpay")}>
              <Undo2 className="h-3.5 w-3.5" strokeWidth={2} />
              Desfazer pagamento
            </button>
          )}
          {isAdjustment && entry.status !== "PAID" && (
            <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
              Excluir
            </button>
          )}
        </div>
      </div>

      {holdOpen && (
        <HoldDialog
          personName={entry.beneficiaryName}
          onClose={() => setHoldOpen(false)}
          onConfirm={async (reason) => {
            const err = await run("hold", { reason });
            if (!err) setHoldOpen(false);
            return err;
          }}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="Excluir este ajuste?"
          description={`${formatCurrency(entry.amount)} de ${entry.beneficiaryName}. Ele deixa de aparecer para a pessoa.`}
          confirmLabel="Excluir ajuste"
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await remove();
            setConfirmDelete(false);
          }}
        />
      )}
    </li>
  );
}
