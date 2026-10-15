import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { requireCommissionManager, auditCommission, badRequest, parseMoney } from "@/lib/commissions/route-helpers";
import { formatMonthShort, isMonthKey } from "@/lib/commissions/engine";
import { formatCurrency } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Lançamento avulso: bônus (+), desconto (−), diferença da meia parcela
 * depois da contemplação, estorno enquanto a regra não é decidida… Sempre
 * com justificativa — é o que aparece pro consultor e na auditoria.
 */
export async function POST(req: Request) {
  const guard = await requireCommissionManager();
  if ("error" in guard) return guard.error;
  const { access } = guard;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return badRequest("Dados inválidos");
  if (typeof body.beneficiaryId !== "string" || !body.beneficiaryId) return badRequest("Escolha a pessoa");
  if (!isMonthKey(body.month)) return badRequest("Escolha o mês");
  const amount = parseMoney(body.amount);
  if (amount == null || amount === 0) return badRequest("Informe o valor");
  if (Math.abs(amount) > 10_000_000) return badRequest("Valor muito alto");
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) : "";
  if (!note) return badRequest("Escreva o motivo do ajuste");
  const saleId = typeof body.saleId === "string" && body.saleId ? body.saleId : null;
  const beneficiaryId = body.beneficiaryId;
  const month = body.month;

  return runWithTenant(access.organizationId, async () => {
    const member = await prisma.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId: access.organizationId, userId: beneficiaryId } },
      select: { user: { select: { name: true } } },
    });
    if (!member) return badRequest("Pessoa inválida");
    if (saleId) {
      const sale = await prisma.commissionSale.findFirst({ where: { id: saleId, organizationId: access.organizationId }, select: { id: true } });
      if (!sale) return badRequest("Venda inválida");
    }

    const entry = await prisma.commissionEntry.create({
      data: {
        organizationId: access.organizationId,
        saleId,
        beneficiaryId,
        kind: "ADJUSTMENT",
        paymentMonth: month,
        amount: amount.toFixed(2),
        note,
        createdById: access.userId,
      },
      select: { id: true },
    });
    await auditCommission(req, access, "COMMISSION_ADJUSTMENT", {
      targetType: "CommissionEntry",
      targetId: entry.id,
      detail: `${member.user.name} · ${amount > 0 ? "+" : ""}${formatCurrency(amount)} · ${formatMonthShort(month)} · "${note}"`,
    });
    return NextResponse.json(entry, { status: 201 });
  });
}
