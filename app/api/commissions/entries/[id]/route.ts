import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { requireCommissionManager, auditCommission, commissionRoute } from "@/lib/commissions/route-helpers";
import { formatCurrency } from "@/lib/format";
import { formatMonthShort } from "@/lib/commissions/engine";

export const dynamic = "force-dynamic";

/** Só ajuste (lançamento avulso) ainda não pago pode ser apagado — parcela de venda se cancela/trava, nunca some. */
export const DELETE = commissionRoute(async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireCommissionManager();
  if ("error" in guard) return guard.error;
  const { access } = guard;

  return runWithTenant(access.organizationId, async () => {
    const entry = await prisma.commissionEntry.findFirst({
      where: { id, organizationId: access.organizationId },
      select: { kind: true, status: true, amount: true, paymentMonth: true, note: true, beneficiary: { select: { name: true } } },
    });
    if (!entry) return NextResponse.json({ error: "Lançamento não encontrado" }, { status: 404 });
    if (entry.kind !== "ADJUSTMENT") return NextResponse.json({ error: "Parcela de venda não se apaga — trave ou cancele a venda" }, { status: 409 });

    const { count } = await prisma.commissionEntry.deleteMany({ where: { id, status: { not: "PAID" } } });
    if (count === 0) return NextResponse.json({ error: "Ajuste já pago — desfaça o pagamento antes" }, { status: 409 });

    await auditCommission(req, access, "COMMISSION_ADJUSTMENT", {
      targetType: "CommissionEntry",
      targetId: id,
      detail: `${entry.beneficiary.name} · apagou ajuste de ${formatCurrency(Number(entry.amount))} · ${formatMonthShort(entry.paymentMonth)} · "${entry.note ?? ""}"`,
    });
    return NextResponse.json({ ok: true });
  });
});
