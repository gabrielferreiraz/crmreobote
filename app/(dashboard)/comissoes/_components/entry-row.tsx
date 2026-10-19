"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, CircleCheck, Lock, LockOpen, MessageCircleQuestion, Trash2, Undo2, UserX } from "lucide-react";
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
  entry: serverEntry,
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
  // Otimista: a linha muda NO CLIQUE (Pago, Travada, Cliente pagou…) e fica
  // assim até o servidor mandar a versão nova da parcela — aí o ajuste local
  // some sozinho (vale só pra aquela versão). Se der erro, volta na hora.
  const [patch, setPatch] = useState<{ base: EntryView; changes: Partial<EntryView> } | null>(null);
  const [removed, setRemoved] = useState<EntryView | null>(null);
  const entry: EntryView = patch && patch.base === serverEntry ? { ...serverEntry, ...patch.changes } : serverEntry;
  const [holdOpen, setHoldOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmUnpaid, setConfirmUnpaid] = useState(false);
  const pushUndoToast = useUndoToast();
  const status = entryDisplayStatus(entry, currentMonth, "manager");

  async function run(action: "pay" | "unpay" | "release" | "hold", body?: { reason?: string }): Promise<string | null> {
    const changes: Partial<EntryView> =
      action === "pay"
        ? { status: "PAID" }
        : action === "unpay"
          ? { status: "SCHEDULED" }
          : action === "release"
            ? { status: "SCHEDULED", holdReason: null }
            : { status: "ON_HOLD", holdReason: body?.reason ?? null };
    setBusy(true);
    setPatch({ base: serverEntry, changes });
    const res = await requestJson(`/api/commissions/entries/${entry.id}/${action}`, { method: "POST", json: body ?? {} }, { silent: action === "hold" });
    setBusy(false);
    if (!res.ok) {
      setPatch(null);
      return res.error;
    }
    pushUndoToast(res.data?.undo);
    onChanged();
    return null;
  }

  /**
   * O ✓ "o cliente pagou a parcela" direto daqui (o mesmo da tela Quem pagou
   * a parcela) — do mês desta parcela. "Pagou" também tira a trava/perda que
   * o "não pagou" tinha aplicado.
   */
  async function markClient(state: "PAID" | "UNPAID") {
    if (!entry.saleId) return;
    const releases = state === "PAID" && (entry.clientPaymentEffect === "HOLD" || entry.clientPaymentEffect === "FORFEIT");
    setBusy(true);
    setPatch({
      base: serverEntry,
      changes: { clientPayment: state, ...(releases ? { status: "SCHEDULED", clientPaymentEffect: null, holdReason: null, note: null } : {}) },
    });
    const res = await requestJson("/api/commissions/client-payments", {
      method: "POST",
      json: { month: entry.paymentMonth, saleIds: [entry.saleId], state },
    });
    setBusy(false);
    if (res.ok) onChanged();
    else setPatch(null);
  }

  async function remove() {
    setBusy(true);
    setRemoved(serverEntry);
    const res = await requestJson(`/api/commissions/entries/${entry.id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) onChanged();
    else setRemoved(null);
  }

  const isAdjustment = entry.kind === "ADJUSTMENT";
  const title = show === "person" ? entry.beneficiaryName : isAdjustment ? (entry.note ?? "Ajuste") : (entry.clientName ?? "Venda");
  const description =
    show === "person"
      ? entryDescription(entry, { withMonth: true })
      : entryDescription(entry, { withAdministrator: true, withClient: isAdjustment });
  const paidDirectly = entry.paidByAdministrator && entry.status !== "PAID" && entry.clientPayment !== "PENDING" && entry.status !== "CANCELLED";
  const displayLabel = paidDirectly ? PAID_BY_ADMINISTRATOR_LABEL : status.label;
  const displayTone = paidDirectly ? "slate" : status.tone;
  const dotTone = {
    neutral: "bg-neutral-400",
    accent: "bg-brand",
    brand: "bg-brand",
    success: "bg-emerald-500",
    danger: "bg-red-500",
    warning: "bg-amber-500",
    blue: "bg-blue-500",
    pink: "bg-pink-500",
    slate: "bg-slate-400",
  }[displayTone];
  const compactAction = "inline-flex min-h-8 flex-1 items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50";
  const secondaryAction = show === "client" ? `${compactAction} text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800` : "btn-secondary btn-sm";
  const ghostAction = show === "client" ? `${compactAction} text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800` : "btn-ghost btn-sm";
  const positiveAction = show === "client" ? `${compactAction} text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-500/10` : "btn-secondary btn-sm";
  const dangerAction = show === "client" ? `${compactAction} text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10` : "btn-ghost btn-sm text-red-600 dark:text-red-400";

  // Ajuste excluído: some na hora (volta se o servidor recusar).
  if (removed && removed === serverEntry) return null;

  return (
    <li className={show === "client" ? "grid items-start gap-x-5 gap-y-3 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,auto)] sm:pl-[4.25rem] lg:grid-cols-[minmax(14rem,1fr)_minmax(9rem,0.38fr)_minmax(15rem,auto)]" : "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"}>
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
            {entry.holdReason}
          </p>
        )}
        {show === "person" && entry.status === "SCHEDULED" && entry.clientPayment === "PENDING" && (
          <p className="text-sm text-amber-700 dark:text-amber-300">Aguardando o cliente</p>
        )}
        {show === "person" && entry.status === "CANCELLED" && entry.clientPaymentEffect === "FORFEIT" && (
          <p className="text-sm text-red-700 dark:text-red-300">Perdida: cliente não pagou</p>
        )}
        {entry.dispute?.status === "OPEN" && (
          <p className="flex items-start gap-1.5 text-sm font-medium text-red-700 dark:text-red-300">
            <MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
            {entry.beneficiaryName.split(" ")[0]} contestou: “{entry.dispute.message}”
          </p>
        )}
      </div>

      <div className={show === "client" ? "contents" : "flex shrink-0 flex-wrap items-center justify-end gap-2"}>
        <div className={show === "client" ? "flex flex-col items-start gap-1 sm:items-end" : "flex flex-col items-end gap-1"}>
          <span className={`text-sm font-semibold tabular-nums ${entry.amount < 0 ? "text-red-600 dark:text-red-400" : "text-neutral-900 dark:text-neutral-100"}`}>
            {formatCurrency(entry.amount)}
          </span>
          {show === "client" ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-400">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotTone}`} />
              {displayLabel}
            </span>
          ) : paidDirectly ? (
            <Badge tone="slate">{PAID_BY_ADMINISTRATOR_LABEL}</Badge>
          ) : (
            <Badge tone={status.tone}>{status.label}</Badge>
          )}
        </div>
        <div className={show === "client" ? "flex w-full overflow-hidden rounded-md border border-neutral-200 bg-white empty:hidden sm:col-span-2 sm:justify-self-end lg:col-span-1 lg:w-auto dark:border-neutral-700 dark:bg-neutral-900 [&>button+button]:border-l [&>button+button]:border-neutral-200 dark:[&>button+button]:border-neutral-700" : "flex flex-wrap items-center justify-end gap-1"}>
          {entry.status === "SCHEDULED" && entry.clientPayment === "PENDING" && entry.saleId && (
            <>
              <button type="button" className={positiveAction} disabled={busy} onClick={() => markClient("PAID")}>
                <CircleCheck className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2.2} />
                Cliente pagou
              </button>
              <button type="button" className={dangerAction} disabled={busy} onClick={() => setConfirmUnpaid(true)}>
                <UserX className="h-3.5 w-3.5" strokeWidth={2} />
                Não pagou
              </button>
            </>
          )}
          {/* Travada ou perdida porque o cliente não pagou: se ele pagou depois, libera daqui mesmo. */}
          {((entry.status === "ON_HOLD" && entry.clientPaymentEffect === "HOLD") || (entry.status === "CANCELLED" && entry.clientPaymentEffect === "FORFEIT")) &&
            entry.saleId && (
              <button type="button" className={positiveAction} disabled={busy} onClick={() => markClient("PAID")}>
                <LockOpen className="h-3.5 w-3.5" strokeWidth={2} />
                O cliente pagou
              </button>
            )}
          {entry.status === "SCHEDULED" && !entry.paidByAdministrator && entry.clientPayment !== "PENDING" && entry.clientPayment !== "UNPAID" && (
            <button type="button" className={secondaryAction} disabled={busy} onClick={() => run("pay")}>
              <Check className="h-3.5 w-3.5" strokeWidth={2.2} />
              Pagar
            </button>
          )}
          {entry.status === "SCHEDULED" && (
            <button type="button" className={ghostAction} disabled={busy} onClick={() => setHoldOpen(true)}>
              <Lock className="h-3.5 w-3.5" strokeWidth={2} />
              Travar
            </button>
          )}
          {entry.status === "ON_HOLD" && entry.clientPaymentEffect !== "HOLD" && (
            <button type="button" className={secondaryAction} disabled={busy} onClick={() => run("release")}>
              <LockOpen className="h-3.5 w-3.5" strokeWidth={2} />
              Destravar
            </button>
          )}
          {entry.status === "PAID" && (
            <button type="button" className={ghostAction} disabled={busy} onClick={() => run("unpay")}>
              <Undo2 className="h-3.5 w-3.5" strokeWidth={2} />
              Desfazer pagamento
            </button>
          )}
          {isAdjustment && entry.status !== "PAID" && (
            <button type="button" className={dangerAction} disabled={busy} onClick={() => setConfirmDelete(true)}>
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
      {confirmUnpaid && (
        <ConfirmDialog
          danger
          title="Cliente não pagou?"
          description={`Aplica a regra da ${entry.administratorName ?? "administradora"} e avisa ${entry.beneficiaryName.split(" ")[0]}.`}
          confirmLabel="Não pagou"
          onClose={() => setConfirmUnpaid(false)}
          onConfirm={async () => {
            await markClient("UNPAID");
            setConfirmUnpaid(false);
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
