import { NextResponse } from "next/server";
import { requireCommissionManager, auditCommission, commissionRoute } from "@/lib/commissions/route-helpers";
import { loadEngineContext, regenerateSaleEntries, SALE_SELECT, withCommissionLock } from "@/lib/commissions/sync";

export const dynamic = "force-dynamic";

/**
 * Uma rota por transição (mesmo desenho de /api/proposals/[id]/[action]):
 *
 *   confirm      REVIEW            → ACTIVE   (venda antiga conferida — o consultor passa a ver)
 *   cancel       REVIEW | ACTIVE   → CANCELLED (parcelas não pagas canceladas; pagas ficam)
 *   reactivate   CANCELLED         → ACTIVE   (só se o negócio ainda estiver ganho)
 *   recalculate  REVIEW | ACTIVE   → mesmo status, parcelas não pagas refeitas pelo cadastro atual
 */
export const POST = commissionRoute(async function POST(req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params;
  if (!["confirm", "cancel", "reactivate", "recalculate"].includes(action)) {
    return NextResponse.json({ error: "Ação inválida" }, { status: 404 });
  }
  const guard = await requireCommissionManager();
  if ("error" in guard) return guard.error;
  const { access } = guard;

  const result = await withCommissionLock(access.organizationId, async (tx) => {
    const sale = await tx.commissionSale.findFirst({
      where: { id, organizationId: access.organizationId },
      select: { ...SALE_SELECT, clientName: true, deal: { select: { status: true } } },
    });
    if (!sale) return { status: 404, error: "Venda não encontrada" };

    if (action === "confirm") {
      if (sale.status !== "REVIEW") return { status: 409, error: "Essa venda não está a conferir" };
      // Confirmar sem administradora deixaria o vendedor sem parcela nenhuma
      // pra ver — a tela já trava o botão, isto é a garantia.
      if (!sale.administratorId) return { status: 409, error: "Escolha a administradora antes de confirmar" };
      await tx.commissionSale.update({ where: { id }, data: { status: "ACTIVE" } });
      return { detail: `${sale.clientName}: conferida` };
    }

    if (action === "cancel") {
      if (sale.status === "CANCELLED") return { status: 409, error: "Essa venda já está cancelada" };
      await tx.commissionSale.update({ where: { id }, data: { status: "CANCELLED", autoCancelled: false } });
      await tx.commissionEntry.updateMany({
        where: { saleId: id, status: { in: ["SCHEDULED", "ON_HOLD"] } },
        data: { status: "CANCELLED" },
      });
      return { detail: `${sale.clientName}: cancelou a comissão` };
    }

    if (action === "reactivate") {
      if (sale.status !== "CANCELLED") return { status: 409, error: "Essa venda não está cancelada" };
      if (sale.deal && sale.deal.status !== "WON") {
        return { status: 409, error: "O negócio não está mais como ganho — marque como ganho de novo primeiro" };
      }
      // Sem negócio e não lançada à mão = o negócio foi excluído; a
      // sincronização cancelaria de novo na próxima abertura.
      if (!sale.deal && sale.source !== "MANUAL") {
        return { status: 409, error: "O negócio desta venda foi excluído" };
      }
      const updated = await tx.commissionSale.update({
        where: { id },
        data: { status: "ACTIVE", autoCancelled: false },
        select: SALE_SELECT,
      });
      await regenerateSaleEntries(tx, updated, await loadEngineContext(tx, access.organizationId));
      return { detail: `${sale.clientName}: reativou a comissão` };
    }

    // recalculate
    if (sale.status === "CANCELLED") return { status: 409, error: "Venda cancelada — reative antes de recalcular" };
    await regenerateSaleEntries(tx, sale, await loadEngineContext(tx, access.organizationId));
    return { detail: `${sale.clientName}: recalculou` };
  });

  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  await auditCommission(req, access, "COMMISSION_SALE_CHANGED", { targetType: "CommissionSale", targetId: id, detail: result.detail });
  return NextResponse.json({ ok: true });
});
