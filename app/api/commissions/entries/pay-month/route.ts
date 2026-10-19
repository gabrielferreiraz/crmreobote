import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { requireCommissionManager, auditCommission, badRequest, commissionRoute } from "@/lib/commissions/route-helpers";
import { formatMonthLong, isMonthKey } from "@/lib/commissions/engine";
import { formatCurrency } from "@/lib/format";
import { notifyPaid } from "@/lib/commissions/notify";
import { clientConfirmedWhere } from "@/lib/commissions/client-payment";
import { recordUndoableAction } from "@/lib/undo/record";
import type { CommissionPayPayload } from "@/lib/undo/types";

export const dynamic = "force-dynamic";

/**
 * "Pagar" do mês — de uma pessoa (`beneficiaryId`) ou de todo mundo (o
 * "Fechar o mês"). Paga SÓ o que a empresa paga e está pronto: parcela não
 * travada, de venda já conferida (ativa) ou ajuste avulso. O que a
 * administradora paga direto fica de fora (não sai do caixa da corretora).
 * Devolve Ctrl+Z (commission.pay) e avisa cada pessoa no celular.
 */
export const POST = commissionRoute(async function POST(req: Request) {
  const guard = await requireCommissionManager();
  if ("error" in guard) return guard.error;
  const { access } = guard;

  const body = (await req.json().catch(() => ({}))) as { month?: unknown; beneficiaryId?: unknown };
  if (!isMonthKey(body.month)) return badRequest("Mês inválido");
  const month = body.month;
  const beneficiaryId = typeof body.beneficiaryId === "string" ? body.beneficiaryId : undefined;

  return runWithTenant(access.organizationId, async () => {
    const base = {
      organizationId: access.organizationId,
      paymentMonth: month,
      status: "SCHEDULED" as const,
      paidByAdministrator: false,
      OR: [{ saleId: null }, { sale: { status: "ACTIVE" as const } }],
      ...(beneficiaryId ? { beneficiaryId } : {}),
    };
    // Só o que o cliente já pagou (ou não depende disso) — o resto espera o ✓.
    const where = { ...base, AND: [clientConfirmedWhere(month)] };
    const [toPay, waiting] = await Promise.all([
      prisma.commissionEntry.findMany({ where, select: { id: true, amount: true, beneficiaryId: true } }),
      prisma.commissionEntry.count({ where: { ...base, NOT: clientConfirmedWhere(month) } }),
    ]);
    if (toPay.length === 0) return NextResponse.json({ paid: 0, total: 0, people: 0, waiting });

    // Só os ids lidos agora (nunca "tudo que bater no where" de novo) — uma
    // parcela travada entre a leitura e a escrita não é paga por engano.
    const { count } = await prisma.commissionEntry.updateMany({
      where: { id: { in: toPay.map((e) => e.id) }, status: "SCHEDULED" },
      data: { status: "PAID", paidAt: new Date(), paidById: access.userId },
    });
    const total = toPay.reduce((acc, e) => acc + Number(e.amount), 0);
    const people = new Set(toPay.map((e) => e.beneficiaryId)).size;

    let who = `${people} ${people === 1 ? "pessoa" : "pessoas"}`;
    if (beneficiaryId) {
      const user = await prisma.user.findUnique({ where: { id: beneficiaryId }, select: { name: true } });
      who = user?.name ?? "?";
    }
    await auditCommission(req, access, "COMMISSION_PAID", {
      targetType: "CommissionEntry",
      detail: `Pagou ${formatMonthLong(month)} de ${who}: ${count} ${count === 1 ? "parcela" : "parcelas"} · ${formatCurrency(total)}`,
    });

    after(() => notifyPaid(toPay.map((e) => ({ beneficiaryId: e.beneficiaryId, amount: Number(e.amount), paymentMonth: month }))));

    const description = beneficiaryId ? `Comissão de ${who} paga` : `Comissões de ${formatMonthLong(month, { withYear: false }).toLowerCase()} pagas`;
    const undo = await recordUndoableAction({
      organizationId: access.organizationId,
      userId: access.userId,
      type: "commission.pay",
      description,
      payload: {
        entryIds: toPay.map((e) => e.id),
        state: "PAID",
        actorUserId: access.userId,
        actorName: access.actorName,
        descriptions: { afterRevert: "Pagamento desfeito", original: description },
      } satisfies CommissionPayPayload,
    });

    return NextResponse.json({ paid: count, total, people, waiting, undo });
  });
});
