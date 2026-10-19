import { NextResponse } from "next/server";
import { prisma, prismaRaw } from "@/lib/prisma";
import { runWithTenant, setTenantOnTx } from "@/lib/tenant-context";
import { requireRole } from "@/lib/require-role";
import { getSharedScope } from "@/lib/share-groups";
import { scopeWhere } from "@/lib/team-scope";
import { buildSaleSchedule, resolveAdministrator } from "@/lib/commissions/engine";
import { LATEST_PROPOSAL_INSTALLMENT, loadEngineContext } from "@/lib/commissions/sync";
import { brazilDateStringWithNowTimeToUTC } from "@/lib/timezone";
import { commissionRoute } from "@/lib/commissions/route-helpers";

export const dynamic = "force-dynamic";

/**
 * Prévia da comissão no "Marcar como ganho" — "essa venda vai te render
 * R$ X em N parcelas". Usa EXATAMENTE o mesmo motor e os mesmos dados que a
 * venda de comissão vai usar quando nascer (valores do negócio, dono do
 * negócio, administradora escolhida, data do ganho), então o número que
 * aparece aqui é o mesmo que o consultor vê depois na "Minha comissão".
 *
 * Quando não dá pra garantir o número (sem regra, sem valor), devolve
 * `pending` e a tela diz que o Financeiro vai confirmar — nunca um número
 * que depois muda. Só a parte do VENDEDOR (é dele que a tela fala).
 */
export const GET = commissionRoute(async function GET(req: Request) {
  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const dealId = params.get("dealId");
  const administratorId = params.get("administratorId");
  const closedAtRaw = params.get("closedAt");
  // Categoria escolhida no próprio diálogo do Ganho (ainda não salva no negócio).
  const creditTypeParam = params.get("creditType");
  if (!dealId || !administratorId || !closedAtRaw || !/^\d{4}-\d{2}-\d{2}$/.test(closedAtRaw)) {
    return NextResponse.json({ status: "inactive" });
  }
  const { organizationId, userId } = access;

  const loaded = await runWithTenant(organizationId, async () => {
    const scope = await getSharedScope(organizationId, userId, access.role, "shareDeals");
    const [deal, org, administrator] = await Promise.all([
      prisma.deal.findFirst({
        where: { id: dealId, organizationId, ...scopeWhere(scope) },
        select: {
          ownerId: true,
          value: true,
          grossValue: true,
          creditType: true,
          owner: { select: { name: true } },
          // Mesma fonte da venda de comissão (ver createSalesFromDeals).
          proposals: LATEST_PROPOSAL_INSTALLMENT,
        },
      }),
      prisma.organization.findUnique({ where: { id: organizationId }, select: { commissionStartDate: true } }),
      prisma.consortiumAdministrator.findFirst({ where: { id: administratorId, organizationId, active: true }, select: { id: true } }),
    ]);
    return { deal, org, administrator };
  });
  if (!loaded.deal) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

  const closedAt = brazilDateStringWithNowTimeToUTC(closedAtRaw);
  const start = loaded.org?.commissionStartDate;
  // Módulo desligado, ou venda de antes do início: não vira comissão sozinha — nada a prever.
  if (!start || closedAt < start || !loaded.administrator) return NextResponse.json({ status: "inactive" });

  const ctx = await prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, organizationId);
    return loadEngineContext(tx, organizationId);
  });
  const deal = loaded.deal;
  const { installments } = buildSaleSchedule(
    {
      sellerId: deal.ownerId,
      supervisorId: null,
      managerId: null,
      administratorId,
      modality: "FULL",
      creditType: creditTypeParam || deal.creditType,
      saleDate: closedAt,
      netValue: deal.value != null ? Number(deal.value) : null,
      grossValue: deal.grossValue != null ? Number(deal.grossValue) : null,
      clientInstallment: deal.proposals[0] ? Number(deal.proposals[0].installment) : null,
    },
    (() => {
      const base = ctx.administrators.get(administratorId);
      return base ? resolveAdministrator(base, creditTypeParam || deal.creditType) : null;
    })(),
    ctx.rules,
  );
  const seller = installments.filter((i) => i.role === "SELLER");
  const base = {
    sellerName: deal.owner.name,
    isMe: deal.ownerId === userId,
    // Corretora que diferencia meia parcela: o valor da prévia é o da parcela cheia.
    hasReducedRules: ctx.rules.some((r) => r.modality === "REDUCED"),
  };
  if (seller.length === 0) return NextResponse.json({ status: "pending", ...base });

  return NextResponse.json({
    status: "ok",
    ...base,
    total: seller.reduce((acc, i) => acc + i.amountCents, 0) / 100,
    count: seller.length,
    firstMonth: seller[0].paymentMonth,
    lastMonth: seller[seller.length - 1].paymentMonth,
    paidByAdministrator: seller[0].paidByAdministrator,
  });
});
