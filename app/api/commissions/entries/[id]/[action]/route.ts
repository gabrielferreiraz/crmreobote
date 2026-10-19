import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { requireCommissionManager, auditCommission, badRequest, commissionRoute } from "@/lib/commissions/route-helpers";
import { formatCurrency } from "@/lib/format";
import { formatMonthLong, formatMonthShort } from "@/lib/commissions/engine";
import { clientAllowsPayment, clientPaymentState } from "@/lib/commissions/client-payment";
import { notifyHeld, notifyPaid } from "@/lib/commissions/notify";
import { applyClientPayments, withCommissionLock } from "@/lib/commissions/sync";
import { recordUndoableAction } from "@/lib/undo/record";
import type { CommissionPayPayload } from "@/lib/undo/types";
import type { AuditAction } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

/**
 * Uma rota por transição de uma parcela:
 *
 *   pay      SCHEDULED → PAID       (venda precisa estar ativa — "a conferir" não paga)
 *   unpay    PAID      → SCHEDULED  (desfaz um pagamento marcado por engano)
 *   hold     SCHEDULED → ON_HOLD    (motivo obrigatório — é o que o consultor lê)
 *   release  ON_HOLD   → SCHEDULED
 *
 * Cada transição só acontece a partir do status esperado (updateMany com o
 * status no WHERE): dois cliques/duas pessoas ao mesmo tempo não pagam duas
 * vezes nem "destravam" o que acabou de ser pago.
 *
 * Pagar/desfazer não pede "Tem certeza?" na tela: acontece na hora e
 * devolve um Ctrl+Z (commission.pay, ver lib/undo/) — o engano se desfaz
 * com um clique em vez de toda ação custar uma confirmação.
 */
const TRANSITIONS = {
  pay: { from: "SCHEDULED", to: "PAID", audit: "COMMISSION_PAID", verb: "pagou" },
  unpay: { from: "PAID", to: "SCHEDULED", audit: "COMMISSION_UNPAID", verb: "desfez o pagamento de" },
  hold: { from: "SCHEDULED", to: "ON_HOLD", audit: "COMMISSION_HELD", verb: "travou" },
  release: { from: "ON_HOLD", to: "SCHEDULED", audit: "COMMISSION_RELEASED", verb: "destravou" },
} as const satisfies Record<string, { from: string; to: string; audit: AuditAction; verb: string }>;

type Action = keyof typeof TRANSITIONS;

const WRONG_STATUS: Record<Action, string> = {
  pay: "Essa parcela não está pronta para pagar (já paga, travada ou cancelada)",
  unpay: "Essa parcela não está paga",
  hold: "Só dá pra travar parcela que ainda não foi paga",
  release: "Essa parcela não está travada",
};

export const POST = commissionRoute(async function POST(req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params;
  if (!(action in TRANSITIONS)) return NextResponse.json({ error: "Ação inválida" }, { status: 404 });
  const transition = TRANSITIONS[action as Action];

  const guard = await requireCommissionManager();
  if ("error" in guard) return guard.error;
  const { access } = guard;

  let holdReason: string | null = null;
  if (action === "hold") {
    const body = (await req.json().catch(() => ({}))) as { reason?: unknown };
    holdReason = typeof body.reason === "string" ? body.reason.trim().slice(0, 140) : "";
    if (!holdReason) return badRequest("Escreva o motivo — é o que o consultor vai ler");
  }

  return runWithTenant(access.organizationId, async () => {
    const entry = await prisma.commissionEntry.findFirst({
      where: { id, organizationId: access.organizationId },
      select: {
        id: true,
        amount: true,
        paymentMonth: true,
        installmentNumber: true,
        installmentCount: true,
        kind: true,
        saleId: true,
        clientPaymentEffect: true,
        beneficiaryId: true,
        beneficiary: { select: { name: true } },
        sale: {
          select: {
            status: true,
            clientName: true,
            autoDebit: true,
            administrator: { select: { unpaidPolicy: true } },
            clientPayments: { select: { month: true, paid: true } },
          },
        },
      },
    });
    if (!entry) return NextResponse.json({ error: "Parcela não encontrada" }, { status: 404 });
    if (action === "pay" && entry.sale && entry.sale.status !== "ACTIVE") {
      return NextResponse.json(
        { error: entry.sale.status === "REVIEW" ? "Confira a venda antes de pagar" : "Venda cancelada" },
        { status: 409 },
      );
    }
    // Trava do "cliente não pagou" não sai à mão: sai sozinha quando o ✓ for marcado.
    if (action === "release" && entry.clientPaymentEffect === "HOLD") {
      return NextResponse.json(
        { error: `Essa trava sai sozinha quando você marcar em "Quem pagou a parcela" que ${entry.sale?.clientName ?? "o cliente"} pagou` },
        { status: 409 },
      );
    }
    // Só paga comissão de parcela que o cliente pagou (quando a administradora depende disso).
    if (action === "pay" && entry.kind === "INSTALLMENT" && entry.sale) {
      const state = clientPaymentState({
        hasSale: true,
        policy: entry.sale.administrator?.unpaidPolicy ?? null,
        autoDebit: entry.sale.autoDebit,
        paid: entry.sale.clientPayments.find((c) => c.month === entry.paymentMonth)?.paid ?? null,
      });
      if (!clientAllowsPayment(state)) {
        return NextResponse.json(
          {
            error: `Antes de pagar, marque em "Quem pagou a parcela" que ${entry.sale.clientName} pagou a parcela de ${formatMonthLong(entry.paymentMonth).toLowerCase()}`,
          },
          { status: 409 },
        );
      }
    }

    const now = new Date();
    const { count } = await prisma.commissionEntry.updateMany({
      where: { id, status: transition.from },
      data:
        action === "pay"
          ? { status: "PAID", paidAt: now, paidById: access.userId }
          : action === "unpay"
            ? { status: "SCHEDULED", paidAt: null, paidById: null }
            : action === "hold"
              ? { status: "ON_HOLD", holdReason }
              : { status: "SCHEDULED", holdReason: null },
    });
    if (count === 0) return NextResponse.json({ error: WRONG_STATUS[action as Action] }, { status: 409 });

    // Parcela que volta a "a receber" passa de novo pela regra do "cliente não
    // pagou" — destravar à mão num mês sem ✓ não libera o pagamento por engano.
    if ((action === "release" || action === "unpay") && entry.saleId && entry.sale) {
      const saleId = entry.saleId;
      const policy = entry.sale.administrator?.unpaidPolicy ?? null;
      await withCommissionLock(access.organizationId, (tx) => applyClientPayments(tx, saleId, policy));
    }

    const amount = Number(entry.amount);
    const what = entry.sale
      ? `${entry.sale.clientName}${entry.installmentNumber ? ` (${entry.installmentNumber}/${entry.installmentCount})` : ""}`
      : "ajuste";
    await auditCommission(req, access, transition.audit, {
      targetType: "CommissionEntry",
      targetId: id,
      detail: `${entry.beneficiary.name} · ${transition.verb} ${what} · ${formatCurrency(amount)} · ${formatMonthShort(entry.paymentMonth)}${holdReason ? ` · "${holdReason}"` : ""}`,
    });

    if (action === "pay") {
      after(() => notifyPaid([{ beneficiaryId: entry.beneficiaryId, amount, paymentMonth: entry.paymentMonth }]));
    }
    if (action === "hold" && holdReason) {
      const reason = holdReason;
      after(() => notifyHeld(entry.beneficiaryId, entry.sale?.clientName ?? null, reason));
    }

    let undo: { id: string; description: string } | undefined;
    if (action === "pay" || action === "unpay") {
      const paid = action === "pay";
      undo = await recordUndoableAction({
        organizationId: access.organizationId,
        userId: access.userId,
        type: "commission.pay",
        description: paid ? "Parcela de comissão paga" : "Pagamento desfeito",
        payload: {
          entryIds: [id],
          state: paid ? "PAID" : "SCHEDULED",
          actorUserId: access.userId,
          actorName: access.actorName,
          descriptions: paid
            ? { afterRevert: "Pagamento desfeito", original: "Parcela de comissão paga" }
            : { afterRevert: "Parcela de comissão paga", original: "Pagamento desfeito" },
        } satisfies CommissionPayPayload,
      });
    }
    return NextResponse.json({ ok: true, undo });
  });
});
