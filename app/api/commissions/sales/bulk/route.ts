import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { requireCommissionManager, auditCommission, badRequest, commissionRoute } from "@/lib/commissions/route-helpers";
import { loadEngineContext, regenerateSaleEntries, SALE_SELECT, withCommissionLock } from "@/lib/commissions/sync";

export const dynamic = "force-dynamic";

const MAX = 100;

/**
 * Conferência em lote (vendas antigas chegam às centenas):
 *   administrator — a mesma administradora pra todas as selecionadas (recalcula as parcelas não pagas)
 *   creditType    — a mesma categoria (Imóvel, Automóvel…) pra todas (recalcula — a categoria muda a comissão)
 *   confirm       — confirma as selecionadas que estavam "a conferir"
 * No máximo 100 por vez: cada venda recalculada custa algumas consultas
 * dentro de UMA transação.
 */
export const POST = commissionRoute(async function POST(req: Request) {
  const guard = await requireCommissionManager();
  if ("error" in guard) return guard.error;
  const { access } = guard;

  const body = (await req.json().catch(() => null)) as { saleIds?: unknown; action?: unknown; administratorId?: unknown; creditType?: unknown } | null;
  if (!body || !Array.isArray(body.saleIds) || body.saleIds.length === 0) return badRequest("Selecione as vendas");
  const saleIds = body.saleIds.filter((id): id is string => typeof id === "string").slice(0, MAX);
  if (body.action !== "administrator" && body.action !== "creditType" && body.action !== "confirm") return badRequest("Ação inválida");

  if (body.action === "confirm") {
    // Só confirma quem já tem administradora — sem ela o vendedor não teria
    // parcela nenhuma pra ver. As que ficaram de fora voltam como `skipped`
    // pra tela avisar.
    const { count, skipped } = await runWithTenant(access.organizationId, async () => {
      const selectedReview = await prisma.commissionSale.count({
        where: { organizationId: access.organizationId, id: { in: saleIds }, status: "REVIEW" },
      });
      const { count } = await prisma.commissionSale.updateMany({
        where: { organizationId: access.organizationId, id: { in: saleIds }, status: "REVIEW", administratorId: { not: null } },
        data: { status: "ACTIVE" },
      });
      return { count, skipped: selectedReview - count };
    });
    await auditCommission(req, access, "COMMISSION_SALE_CHANGED", {
      targetType: "CommissionSale",
      detail: `Conferiu ${count} ${count === 1 ? "venda" : "vendas"} de uma vez`,
    });
    return NextResponse.json({ updated: count, skipped });
  }

  if (body.action === "creditType") {
    if (typeof body.creditType !== "string" || !body.creditType.trim()) return badRequest("Escolha a categoria");
    const wanted = body.creditType.trim();
    // Só categoria cadastrada na organização — é o que as tabelas e regras usam.
    const creditType = await runWithTenant(access.organizationId, () =>
      prisma.creditType.findFirst({ where: { organizationId: access.organizationId, label: { equals: wanted, mode: "insensitive" } }, select: { label: true } }),
    );
    if (!creditType) return badRequest("Categoria inválida");

    const updated = await withCommissionLock(access.organizationId, async (tx) => {
      const ctx = await loadEngineContext(tx, access.organizationId);
      const sales = await tx.commissionSale.findMany({
        where: { organizationId: access.organizationId, id: { in: saleIds }, status: { in: ["ACTIVE", "REVIEW"] } },
        select: { id: true },
      });
      for (const sale of sales) {
        const row = await tx.commissionSale.update({ where: { id: sale.id }, data: { creditType: creditType.label }, select: SALE_SELECT });
        await regenerateSaleEntries(tx, row, ctx);
      }
      return sales.length;
    });
    await auditCommission(req, access, "COMMISSION_SALE_CHANGED", {
      targetType: "CommissionSale",
      detail: `Escolheu a categoria ${creditType.label} para ${updated} ${updated === 1 ? "venda" : "vendas"} de uma vez`,
    });
    return NextResponse.json({ updated });
  }

  if (typeof body.administratorId !== "string") return badRequest("Escolha a administradora");
  const administratorId = body.administratorId;
  const administrator = await runWithTenant(access.organizationId, () =>
    prisma.consortiumAdministrator.findFirst({ where: { id: administratorId, organizationId: access.organizationId }, select: { name: true } }),
  );
  if (!administrator) return badRequest("Administradora inválida");

  const updated = await withCommissionLock(access.organizationId, async (tx) => {
    const ctx = await loadEngineContext(tx, access.organizationId);
    const sales = await tx.commissionSale.findMany({
      where: { organizationId: access.organizationId, id: { in: saleIds }, status: { in: ["ACTIVE", "REVIEW"] } },
      select: { id: true },
    });
    for (const sale of sales) {
      const row = await tx.commissionSale.update({ where: { id: sale.id }, data: { administratorId }, select: SALE_SELECT });
      await regenerateSaleEntries(tx, row, ctx);
    }
    return sales.length;
  });

  await auditCommission(req, access, "COMMISSION_SALE_CHANGED", {
    targetType: "CommissionSale",
    detail: `Escolheu ${administrator.name} para ${updated} ${updated === 1 ? "venda" : "vendas"} de uma vez`,
  });
  return NextResponse.json({ updated });
});
