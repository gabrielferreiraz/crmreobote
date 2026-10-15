import { NextResponse } from "next/server";
import { requireCommissionManager, auditCommission } from "@/lib/commissions/route-helpers";
import { loadEngineContext, regenerateSaleEntries, SALE_SELECT, withCommissionLock } from "@/lib/commissions/sync";

export const dynamic = "force-dynamic";

const BATCH = 80;

/**
 * "Aplicar às vendas em aberto" depois de mudar uma regra/administradora —
 * refaz SÓ as vendas que ainda não tiveram NENHUMA parcela paga (as que já
 * começaram a ser pagas ficam como estão; corrigir uma delas é decisão
 * caso a caso, pela própria venda). Em lotes: devolve quantas faltam e a
 * tela chama de novo.
 */
export async function POST(req: Request) {
  const guard = await requireCommissionManager();
  if ("error" in guard) return guard.error;
  const { access } = guard;

  const body = (await req.json().catch(() => ({}))) as { administratorId?: unknown; afterId?: unknown };
  const administratorId = typeof body.administratorId === "string" ? body.administratorId : undefined;
  // Cursor: sem ele, uma venda que continua "sem parcela paga" depois de
  // refeita voltaria em todo lote e o laço nunca terminaria.
  const afterId = typeof body.afterId === "string" ? body.afterId : undefined;

  const result = await withCommissionLock(access.organizationId, async (tx) => {
    const where = {
      organizationId: access.organizationId,
      status: { in: ["ACTIVE" as const, "REVIEW" as const] },
      entries: { none: { status: "PAID" as const } },
      ...(administratorId ? { administratorId } : {}),
      ...(afterId ? { id: { gt: afterId } } : {}),
    };
    const sales = await tx.commissionSale.findMany({ where, select: SALE_SELECT, orderBy: { id: "asc" }, take: BATCH });
    const ctx = await loadEngineContext(tx, access.organizationId);
    for (const sale of sales) await regenerateSaleEntries(tx, sale, ctx);
    const lastId = sales.at(-1)?.id;
    const remaining = lastId ? await tx.commissionSale.count({ where: { ...where, id: { gt: lastId } } }) : 0;
    return { updated: sales.length, remaining, lastId: lastId ?? null };
  });

  if (!afterId && result.updated > 0) {
    await auditCommission(req, access, "COMMISSION_SALE_CHANGED", {
      targetType: "CommissionSale",
      detail: `Recalculou as vendas sem parcela paga${administratorId ? " de uma administradora" : ""}`,
    });
  }
  return NextResponse.json(result);
}
