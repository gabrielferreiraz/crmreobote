import { after, NextResponse } from "next/server";
import { requireCommissionManager, auditCommission, badRequest, commissionRoute } from "@/lib/commissions/route-helpers";
import { markClientPayments, withCommissionLock } from "@/lib/commissions/sync";
import { formatMonthLong, isMonthKey } from "@/lib/commissions/engine";
import { notifyClientsUnpaid } from "@/lib/commissions/notify";

export const dynamic = "force-dynamic";

const MAX = 500;

/**
 * O ✓ de "o cliente pagou a parcela" — de uma venda ou de várias de uma vez
 * ("marcar todos os que faltam"):
 *   PAID    — pagou: a comissão daquele mês fica liberada pra pagar;
 *   UNPAID  — não pagou: aplica a regra da administradora (trava / perde /
 *             passa pro mês seguinte) e avisa o vendedor;
 *   PENDING — volta pra "falta conferir" (desfaz o que tinha sido marcado).
 * Tudo dentro da trava por organização (mesma do recálculo das vendas).
 */
export const POST = commissionRoute(async function POST(req: Request) {
  const guard = await requireCommissionManager();
  if ("error" in guard) return guard.error;
  const { access } = guard;

  const body = (await req.json().catch(() => null)) as { month?: unknown; saleIds?: unknown; state?: unknown } | null;
  if (!body || !isMonthKey(body.month)) return badRequest("Mês inválido");
  if (!Array.isArray(body.saleIds) || body.saleIds.length === 0) return badRequest("Escolha as vendas");
  if (body.state !== "PAID" && body.state !== "UNPAID" && body.state !== "PENDING") return badRequest("Opção inválida");
  const month = body.month;
  const state = body.state;
  const saleIds = Array.from(new Set(body.saleIds.filter((id): id is string => typeof id === "string"))).slice(0, MAX);

  const result = await withCommissionLock(access.organizationId, (tx) =>
    markClientPayments(tx, { organizationId: access.organizationId, userId: access.userId, saleIds, month, state }),
  );

  const verb = state === "PAID" ? "pagou" : state === "UNPAID" ? "NÃO pagou" : "falta conferir";
  await auditCommission(req, access, "COMMISSION_SALE_CHANGED", {
    targetType: "CommissionSale",
    detail:
      result.sales.length === 1
        ? `${result.sales[0].clientName}: cliente ${verb} a parcela de ${formatMonthLong(month).toLowerCase()}`
        : `${result.sales.length} vendas: cliente ${verb} a parcela de ${formatMonthLong(month).toLowerCase()}`,
  });

  if (result.newlyUnpaid.length > 0) {
    const toNotify = result.newlyUnpaid.flatMap((s) =>
      s.administrator && s.administrator.unpaidPolicy !== "IGNORE"
        ? [{ userId: s.sellerId, clientName: s.clientName, policy: s.administrator.unpaidPolicy }]
        : [],
    );
    after(() => notifyClientsUnpaid(toNotify, month));
  }
  return NextResponse.json({ updated: result.sales.length });
});
