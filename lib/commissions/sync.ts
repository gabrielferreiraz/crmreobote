/**
 * Ponte entre o banco e o motor puro (lib/commissions/engine.ts): cria a
 * venda de comissão quando um negócio é ganho, cancela quando ele sai do
 * Ganho, e (re)gera as parcelas de uma venda.
 *
 * Não depende de "toda rota que marca Ganho lembrar de chamar isto": além
 * das chamadas diretas (PUT /api/deals/[id], ganho em massa), a própria tela
 * de Comissões roda `syncCommissionSales` ao abrir — negócio ganho por API,
 * importação ou qualquer caminho novo entra do mesmo jeito, só que na
 * próxima vez que alguém abrir a tela.
 *
 * Tudo roda numa transação com trava por organização (advisory lock): duas
 * abas abrindo a tela ao mesmo tempo nunca geram as parcelas em dobro.
 */

import { prismaRaw } from "@/lib/prisma";
import { setTenantOnTx } from "@/lib/tenant-context";
import type { Prisma } from "@/app/generated/prisma/client";
import {
  brazilMonthKey,
  buildSaleSchedule,
  parsePercentList,
  type AdministratorLike,
  type RuleLike,
  type SaleLike,
} from "@/lib/commissions/engine";

type Tx = Prisma.TransactionClient;

/**
 * Lote máximo de negócios convertidos por chamada — o resto entra na
 * próxima. Cada venda custa ~4 consultas dentro de UMA transação contra o
 * banco remoto; lote grande estoura o tempo da transação.
 */
const SYNC_BATCH = 100;
export const LEGACY_BATCH = 100;

export async function withCommissionLock<T>(organizationId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prismaRaw.$transaction(
    async (tx) => {
      await setTenantOnTx(tx, organizationId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId}, 20261008))`;
      return fn(tx);
    },
    { timeout: 60_000, maxWait: 15_000 },
  );
}

export type EngineContext = {
  rules: RuleLike[];
  administrators: Map<string, AdministratorLike>;
};

export async function loadEngineContext(tx: Tx, organizationId: string): Promise<EngineContext> {
  const rules = await tx.commissionRule.findMany({ where: { organizationId, active: true } });
  const administrators = await tx.consortiumAdministrator.findMany({ where: { organizationId } });
  return {
    rules: rules.map((r) => ({
      id: r.id,
      beneficiaryRole: r.beneficiaryRole,
      userId: r.userId,
      administratorId: r.administratorId,
      modality: r.modality,
      creditType: r.creditType,
      base: r.base,
      percent: Number(r.percent),
      active: r.active,
      updatedAt: r.updatedAt,
    })),
    administrators: new Map(
      administrators.map((a) => [
        a.id,
        {
          id: a.id,
          commissionInstallments: a.commissionInstallments,
          graceMonths: a.graceMonths,
          cutoffDay: a.cutoffDay,
          paysSellerDirectly: a.paysSellerDirectly,
          revenueMode: a.revenueMode,
          revenueTotalPercent: a.revenueTotalPercent != null ? Number(a.revenueTotalPercent) : null,
          revenuePercents: parsePercentList(a.revenuePercents),
          revenueBase: a.revenueBase === "GROSS" ? "GROSS" : "NET",
        },
      ]),
    ),
  };
}

type SaleRow = {
  id: string;
  organizationId: string;
  status: "REVIEW" | "ACTIVE" | "CANCELLED";
  sellerId: string;
  supervisorId: string | null;
  managerId: string | null;
  administratorId: string | null;
  modality: "FULL" | "REDUCED";
  creditType: string | null;
  saleDate: Date;
  netValue: Prisma.Decimal | null;
  grossValue: Prisma.Decimal | null;
  clientInstallment: Prisma.Decimal | null;
};

export function toSaleLike(sale: SaleRow): SaleLike {
  return {
    sellerId: sale.sellerId,
    supervisorId: sale.supervisorId,
    managerId: sale.managerId,
    administratorId: sale.administratorId,
    modality: sale.modality,
    creditType: sale.creditType,
    saleDate: sale.saleDate,
    netValue: sale.netValue != null ? Number(sale.netValue) : null,
    grossValue: sale.grossValue != null ? Number(sale.grossValue) : null,
    clientInstallment: sale.clientInstallment != null ? Number(sale.clientInstallment) : null,
  };
}

const centsToDecimalString = (cents: number) => (cents / 100).toFixed(2);

/**
 * Refaz as parcelas de UMA venda a partir do cadastro atual (administradora,
 * regras, valores). Parcela PAGA nunca é tocada — só as que ainda não foram
 * pagas são apagadas e geradas de novo, e uma parcela já paga não é gerada
 * outra vez. Parcela travada continua travada (mesmo motivo) se ainda
 * existir depois do recálculo.
 *
 * Venda antiga ainda "a conferir": parcela de mês que já passou nasce PAGA
 * ("pago antes do sistema") — é a suposição combinada com o dono; o
 * Financeiro desfaz as exceções. Só na PRIMEIRA vez que aquela parcela
 * existe: uma parcela que o Financeiro já mexeu não volta a ser paga sozinha.
 *
 * Junto, refaz o que a CORRETORA recebe da administradora (CommissionRevenue)
 * — mesma regra: parcela já marcada como recebida nunca é refeita.
 */
export async function regenerateSaleEntries(tx: Tx, sale: SaleRow, ctx: EngineContext, now: Date = new Date()) {
  const existing = await tx.commissionEntry.findMany({
    where: { saleId: sale.id, kind: "INSTALLMENT" },
    select: { role: true, installmentNumber: true, status: true, holdReason: true },
  });
  const keyOf = (role: string, n: number | null) => `${role}#${n ?? 0}`;
  const paidKeys = new Set(existing.filter((e) => e.status === "PAID").map((e) => keyOf(e.role, e.installmentNumber)));
  const knownKeys = new Set(existing.map((e) => keyOf(e.role, e.installmentNumber)));
  const holds = new Map(
    existing.filter((e) => e.status === "ON_HOLD").map((e) => [keyOf(e.role, e.installmentNumber), e.holdReason]),
  );

  await tx.commissionEntry.deleteMany({ where: { saleId: sale.id, kind: "INSTALLMENT", status: { not: "PAID" } } });
  const receivedRevenue = await tx.commissionRevenue.findMany({
    where: { saleId: sale.id, status: "RECEIVED" },
    select: { installmentNumber: true },
  });
  await tx.commissionRevenue.deleteMany({ where: { saleId: sale.id, status: { not: "RECEIVED" } } });
  if (sale.status === "CANCELLED") return;

  const administrator = sale.administratorId ? (ctx.administrators.get(sale.administratorId) ?? null) : null;
  const { installments, revenue } = buildSaleSchedule(toSaleLike(sale), administrator, ctx.rules);
  const currentMonth = brazilMonthKey(now);

  const receivedNumbers = new Set(receivedRevenue.map((r) => r.installmentNumber));
  const revenueData = revenue
    .filter((r) => !receivedNumbers.has(r.installmentNumber))
    .map((r) => ({
      organizationId: sale.organizationId,
      saleId: sale.id,
      installmentNumber: r.installmentNumber,
      installmentCount: r.installmentCount,
      paymentMonth: r.paymentMonth,
      amount: centsToDecimalString(r.amountCents),
      percent: r.percent.toFixed(4),
    }));
  if (revenueData.length > 0) await tx.commissionRevenue.createMany({ data: revenueData });

  const data = installments
    .filter((i) => !paidKeys.has(keyOf(i.role, i.installmentNumber)))
    .map((i) => {
      const key = keyOf(i.role, i.installmentNumber);
      const paidBeforeSystem = sale.status === "REVIEW" && !knownKeys.has(key) && i.paymentMonth < currentMonth;
      const hold = holds.get(key);
      return {
        organizationId: sale.organizationId,
        saleId: sale.id,
        beneficiaryId: i.beneficiaryId,
        role: i.role,
        kind: "INSTALLMENT" as const,
        installmentNumber: i.installmentNumber,
        installmentCount: i.installmentCount,
        paymentMonth: i.paymentMonth,
        amount: centsToDecimalString(i.amountCents),
        percent: i.percent.toFixed(4),
        ruleId: i.ruleId,
        paidByAdministrator: i.paidByAdministrator,
        status: hold !== undefined ? ("ON_HOLD" as const) : paidBeforeSystem ? ("PAID" as const) : ("SCHEDULED" as const),
        holdReason: hold ?? null,
        note: paidBeforeSystem ? "Pago antes do sistema" : null,
      };
    });
  if (data.length > 0) await tx.commissionEntry.createMany({ data });
}

const SALE_SELECT = {
  id: true,
  organizationId: true,
  status: true,
  source: true,
  sellerId: true,
  supervisorId: true,
  managerId: true,
  administratorId: true,
  modality: true,
  creditType: true,
  saleDate: true,
  netValue: true,
  grossValue: true,
  clientInstallment: true,
} as const;

/**
 * Parcela (mensalidade) do cliente pela proposta mais recente que saiu do
 * rascunho — é o valor que a administradora "% da parcela do cliente" usa.
 * O Financeiro corrige na venda quando não houver proposta.
 */
export const LATEST_PROPOSAL_INSTALLMENT = {
  where: { status: { in: ["ACCEPTED" as const, "SENT" as const, "GENERATED" as const] } },
  orderBy: { updatedAt: "desc" as const },
  take: 1,
  select: { installment: true },
};

const DEAL_FOR_SALE_SELECT = {
  id: true,
  ownerId: true,
  administratorId: true,
  creditType: true,
  closedAt: true,
  value: true,
  grossValue: true,
  contact: { select: { name: true } },
  proposals: LATEST_PROPOSAL_INSTALLMENT,
} as const;

type DealForSale = {
  id: string;
  ownerId: string;
  administratorId: string | null;
  creditType: string | null;
  closedAt: Date | null;
  value: Prisma.Decimal | null;
  grossValue: Prisma.Decimal | null;
  contact: { name: string };
  proposals: { installment: Prisma.Decimal }[];
};

/** Cria a venda de comissão (fotografia do negócio + equipe do vendedor HOJE) e gera as parcelas. */
async function createSalesFromDeals(
  tx: Tx,
  organizationId: string,
  deals: DealForSale[],
  kind: { source: "CRM" | "LEGACY"; status: "ACTIVE" | "REVIEW" },
  ctx: EngineContext,
): Promise<number> {
  if (deals.length === 0) return 0;
  const sellerIds = Array.from(new Set(deals.map((d) => d.ownerId)));
  const memberships = await tx.organizationUser.findMany({
    where: { organizationId, userId: { in: sellerIds } },
    select: { userId: true, team: { select: { leaderId: true, managerId: true } } },
  });
  const teamBySeller = new Map(memberships.map((m) => [m.userId, m.team]));

  let created = 0;
  for (const deal of deals) {
    const team = teamBySeller.get(deal.ownerId) ?? null;
    const sale = await tx.commissionSale.create({
      data: {
        organizationId,
        dealId: deal.id,
        sourceDealId: deal.id,
        source: kind.source,
        status: kind.status,
        clientName: deal.contact.name,
        sellerId: deal.ownerId,
        supervisorId: team?.leaderId ?? null,
        managerId: team?.managerId ?? null,
        administratorId: deal.administratorId,
        creditType: deal.creditType,
        saleDate: deal.closedAt ?? new Date(),
        netValue: deal.value,
        grossValue: deal.grossValue,
        clientInstallment: deal.proposals[0]?.installment ?? null,
      },
      select: SALE_SELECT,
    });
    await regenerateSaleEntries(tx, sale, ctx);
    created++;
  }
  return created;
}

export type SyncResult = { created: number; cancelled: number; revived: number; filled: number };

/**
 * Deixa as vendas de comissão em dia com os negócios. `dealIds` limita a
 * esses negócios (chamada logo depois de marcar Ganho/Perdido); sem isso,
 * passa pela organização inteira. Não faz nada enquanto o módulo não tiver
 * data de início (Organization.commissionStartDate).
 */
export async function syncCommissionSales(organizationId: string, opts?: { dealIds?: string[] }): Promise<SyncResult> {
  const result: SyncResult = { created: 0, cancelled: 0, revived: 0, filled: 0 };
  if (opts?.dealIds && opts.dealIds.length === 0) return result;

  return withCommissionLock(organizationId, async (tx) => {
    const org = await tx.organization.findUnique({ where: { id: organizationId }, select: { commissionStartDate: true } });
    if (!org?.commissionStartDate) return result;

    const dealIdFilter = opts?.dealIds ? { id: { in: opts.dealIds } } : {};
    const saleDealFilter = opts?.dealIds ? { dealId: { in: opts.dealIds } } : {};
    const ctx = await loadEngineContext(tx, organizationId);

    // 1. Negócio ganho desde o início do módulo, ainda sem venda de comissão.
    const newDeals = await tx.deal.findMany({
      where: {
        organizationId,
        status: "WON",
        closedAt: { gte: org.commissionStartDate },
        commissionSale: { is: null },
        ...dealIdFilter,
      },
      select: DEAL_FOR_SALE_SELECT,
      orderBy: { closedAt: "asc" },
      take: SYNC_BATCH,
    });
    // Negócio excluído e restaurado pelo Ctrl+Z volta com o MESMO id — a
    // venda dele ainda existe (dealId virou null na exclusão): reconecta em
    // vez de criar uma segunda comissão. O passo 3 abaixo a reativa.
    const orphanSales = newDeals.length
      ? await tx.commissionSale.findMany({
          where: { organizationId, dealId: null, sourceDealId: { in: newDeals.map((d) => d.id) } },
          select: { id: true, sourceDealId: true },
        })
      : [];
    for (const orphan of orphanSales) {
      await tx.commissionSale.update({ where: { id: orphan.id }, data: { dealId: orphan.sourceDealId } });
    }
    const reconnected = new Set(orphanSales.map((o) => o.sourceDealId));
    result.created = await createSalesFromDeals(
      tx,
      organizationId,
      newDeals.filter((d) => !reconnected.has(d.id)),
      { source: "CRM", status: "ACTIVE" },
      ctx,
    );

    // 2. Negócio saiu do Ganho (ou foi excluído) → a venda cancela sozinha
    // (parcelas pagas ficam). Venda "fora do CRM" nunca teve negócio — fica.
    const toCancel = await tx.commissionSale.findMany({
      where: {
        organizationId,
        status: { in: ["ACTIVE", "REVIEW"] },
        OR: [{ deal: { status: { not: "WON" } } }, { dealId: null, source: { not: "MANUAL" } }],
        ...saleDealFilter,
      },
      select: { id: true },
    });
    for (const sale of toCancel) {
      await tx.commissionSale.update({ where: { id: sale.id }, data: { status: "CANCELLED", autoCancelled: true } });
      await tx.commissionEntry.updateMany({
        where: { saleId: sale.id, status: { in: ["SCHEDULED", "ON_HOLD"] } },
        data: { status: "CANCELLED" },
      });
    }
    result.cancelled = toCancel.length;

    // 3. Negócio voltou a ser ganho → a venda cancelada SOZINHA volta junto.
    const toRevive = await tx.commissionSale.findMany({
      where: { organizationId, status: "CANCELLED", autoCancelled: true, deal: { status: "WON" }, ...saleDealFilter },
      select: SALE_SELECT,
    });
    for (const sale of toRevive) {
      const status = sale.source === "LEGACY" ? ("REVIEW" as const) : ("ACTIVE" as const);
      const updated = await tx.commissionSale.update({
        where: { id: sale.id },
        data: { status, autoCancelled: false },
        select: SALE_SELECT,
      });
      await regenerateSaleEntries(tx, updated, ctx);
    }
    result.revived = toRevive.length;

    // 4. Venda que nasceu sem administradora e o negócio ganhou uma depois.
    const missingAdministrator = await tx.commissionSale.findMany({
      where: {
        organizationId,
        status: { in: ["ACTIVE", "REVIEW"] },
        administratorId: null,
        deal: { administratorId: { not: null } },
        ...saleDealFilter,
      },
      select: { id: true, deal: { select: { administratorId: true } } },
    });
    for (const row of missingAdministrator) {
      const updated = await tx.commissionSale.update({
        where: { id: row.id },
        data: { administratorId: row.deal!.administratorId },
        select: SALE_SELECT,
      });
      await regenerateSaleEntries(tx, updated, ctx);
    }
    result.filled = missingAdministrator.length;

    // 5. Venda que ficou sem parcela nenhuma (ainda não havia regra/valor) —
    // tenta de novo: se o Financeiro cadastrou a regra depois, ela passa a
    // ter comissão sem ninguém precisar lembrar de "recalcular". Venda que
    // continua sem regra simplesmente segue sem parcela (e com o aviso).
    if (!opts?.dealIds) {
      const empty = await tx.commissionSale.findMany({
        where: {
          organizationId,
          status: { in: ["ACTIVE", "REVIEW"] },
          administratorId: { not: null },
          entries: { none: { kind: "INSTALLMENT" } },
        },
        select: SALE_SELECT,
        take: SYNC_BATCH,
      });
      for (const sale of empty) await regenerateSaleEntries(tx, sale, ctx);
    }

    return result;
  });
}

/**
 * Sincronização chamada de dentro de rotas de negócio (Ganho/Perdido/
 * reabrir) — NUNCA pode derrubar a ação principal: se falhar, só loga; a
 * tela de Comissões refaz a sincronização na próxima abertura.
 */
export function syncCommissionSalesInBackground(organizationId: string, dealIds: string[]) {
  return syncCommissionSales(organizationId, { dealIds }).catch((err) =>
    console.error("[commissions] falha ao sincronizar vendas", err),
  );
}

/** Quantos negócios ganhos entre `from` e o início do módulo ainda não viraram comissão. */
export async function countLegacyCandidates(tx: Tx, organizationId: string, from: Date, until: Date) {
  return tx.deal.count({
    where: { organizationId, status: "WON", closedAt: { gte: from, lt: until }, commissionSale: { is: null } },
  });
}

/** "Trazer vendas antigas": negócios ganhos antes do início do módulo entram "a conferir". */
export async function importLegacySales(tx: Tx, organizationId: string, from: Date, until: Date): Promise<number> {
  // Em lotes (ver LEGACY_BATCH) — a tela chama de novo até acabar.
  const ctx = await loadEngineContext(tx, organizationId);
  const deals = await tx.deal.findMany({
    where: { organizationId, status: "WON", closedAt: { gte: from, lt: until }, commissionSale: { is: null } },
    select: DEAL_FOR_SALE_SELECT,
    orderBy: { closedAt: "asc" },
    take: LEGACY_BATCH,
  });
  return createSalesFromDeals(tx, organizationId, deals, { source: "LEGACY", status: "REVIEW" }, ctx);
}

export { SALE_SELECT };
