/**
 * Leituras das telas de Comissões — formato já serializável (número, não
 * Decimal; string, não Date) pra passar direto pros componentes de cliente.
 */

import { prisma, prismaRaw } from "@/lib/prisma";
import { addMonths, brazilMonthKey, buildSaleSchedule, problemLabel, type BeneficiaryRole } from "@/lib/commissions/engine";
import { loadEngineContext, toSaleLike } from "@/lib/commissions/sync";
import { setTenantOnTx } from "@/lib/tenant-context";
import { brazilDateStringToUTC } from "@/lib/timezone";

export type EntryStatus = "SCHEDULED" | "ON_HOLD" | "PAID" | "CANCELLED";

export type EntryView = {
  id: string;
  saleId: string | null;
  clientName: string | null;
  administratorName: string | null;
  role: BeneficiaryRole;
  kind: "INSTALLMENT" | "ADJUSTMENT";
  installmentNumber: number | null;
  installmentCount: number | null;
  paymentMonth: string;
  amount: number;
  status: EntryStatus;
  paidByAdministrator: boolean;
  holdReason: string | null;
  note: string | null;
  beneficiaryId: string;
  beneficiaryName: string;
  /** "Como foi calculado" — pra mostrar a conta ao abrir a linha. */
  dealId: string | null;
  saleDate: string | null;
  modality: "FULL" | "REDUCED" | null;
  percent: number | null;
  /** Valor da venda sobre o qual o percentual foi aplicado (líquido ou bruto, conforme a regra). */
  baseValue: number | null;
  /** COMPANY_REVENUE = "% do que a corretora recebe" (baseValue é o total que a corretora recebe pela venda). */
  baseKind: "NET" | "GROSS" | "COMPANY_REVENUE" | null;
  /** Contestação mais recente desta parcela ("Esse valor está errado?"). */
  dispute: { status: "OPEN" | "RESOLVED"; message: string; response: string | null; createdAt: string } | null;
};

const ENTRY_SELECT = {
  id: true,
  saleId: true,
  role: true,
  kind: true,
  installmentNumber: true,
  installmentCount: true,
  paymentMonth: true,
  amount: true,
  status: true,
  paidByAdministrator: true,
  holdReason: true,
  note: true,
  percent: true,
  beneficiaryId: true,
  beneficiary: { select: { name: true } },
  rule: { select: { base: true } },
  disputes: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: { status: true, message: true, response: true, createdAt: true },
  },
  sale: {
    select: {
      clientName: true,
      dealId: true,
      saleDate: true,
      modality: true,
      netValue: true,
      grossValue: true,
      administrator: { select: { name: true } },
      revenues: { select: { amount: true } },
    },
  },
} as const;

type EntryRow = {
  id: string;
  saleId: string | null;
  role: BeneficiaryRole;
  kind: "INSTALLMENT" | "ADJUSTMENT";
  installmentNumber: number | null;
  installmentCount: number | null;
  paymentMonth: string;
  amount: { toString(): string };
  status: EntryStatus;
  paidByAdministrator: boolean;
  holdReason: string | null;
  note: string | null;
  percent: { toString(): string } | null;
  beneficiaryId: string;
  beneficiary: { name: string };
  rule: { base: "NET" | "GROSS" | "COMPANY_REVENUE" } | null;
  disputes: { status: "OPEN" | "RESOLVED"; message: string; response: string | null; createdAt: Date }[];
  sale: {
    clientName: string;
    dealId: string | null;
    saleDate: Date;
    modality: "FULL" | "REDUCED";
    netValue: { toString(): string } | null;
    grossValue: { toString(): string } | null;
    administrator: { name: string } | null;
    revenues: { amount: { toString(): string } }[];
  } | null;
};

/** Sobre qual valor o % daquela parcela foi aplicado — pra mostrar a conta ao abrir a linha. */
function baseValueOf(e: EntryRow): number | null {
  if (!e.sale || !e.rule) return null;
  const raw =
    e.rule.base === "COMPANY_REVENUE"
      ? e.sale.revenues.reduce((acc, r) => acc + Number(r.amount), 0)
      : Number((e.rule.base === "GROSS" ? e.sale.grossValue : e.sale.netValue) ?? 0);
  return raw > 0 ? raw : null;
}

function toEntryView(e: EntryRow): EntryView {
  return {
    id: e.id,
    saleId: e.saleId,
    clientName: e.sale?.clientName ?? null,
    administratorName: e.sale?.administrator?.name ?? null,
    role: e.role,
    kind: e.kind,
    installmentNumber: e.installmentNumber,
    installmentCount: e.installmentCount,
    paymentMonth: e.paymentMonth,
    amount: Number(e.amount),
    status: e.status,
    paidByAdministrator: e.paidByAdministrator,
    holdReason: e.holdReason,
    note: e.note,
    beneficiaryId: e.beneficiaryId,
    beneficiaryName: e.beneficiary.name,
    dealId: e.sale?.dealId ?? null,
    saleDate: e.sale?.saleDate.toISOString() ?? null,
    modality: e.sale?.modality ?? null,
    percent: e.percent != null ? Number(e.percent) : null,
    baseValue: baseValueOf(e),
    baseKind: e.rule?.base ?? null,
    dispute: e.disputes[0]
      ? { status: e.disputes[0].status, message: e.disputes[0].message, response: e.disputes[0].response, createdAt: e.disputes[0].createdAt.toISOString() }
      : null,
  };
}

/** Só parcela de venda conferida (ativa) ou ajuste avulso — "a conferir" e cancelada não aparecem pra ninguém fora da tela da venda. */
const VISIBLE_SALE = { OR: [{ saleId: null }, { sale: { status: "ACTIVE" as const } }] };

/** "Minha comissão": do primeiro mês visível em diante, nunca de outra pessoa. */
export async function getMyCommissionEntries(organizationId: string, userId: string, fromMonth: string): Promise<EntryView[]> {
  const rows = await prisma.commissionEntry.findMany({
    where: {
      organizationId,
      beneficiaryId: userId,
      status: { not: "CANCELLED" },
      paymentMonth: { gte: fromMonth },
      ...VISIBLE_SALE,
    },
    select: ENTRY_SELECT,
    orderBy: [{ paymentMonth: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toEntryView);
}

/** Tudo de um mês (Financeiro). */
export async function getMonthEntries(organizationId: string, month: string): Promise<EntryView[]> {
  const rows = await prisma.commissionEntry.findMany({
    where: { organizationId, paymentMonth: month, status: { not: "CANCELLED" }, ...VISIBLE_SALE },
    select: ENTRY_SELECT,
    orderBy: [{ createdAt: "asc" }],
  });
  return rows.map(toEntryView);
}

export type ManagerAlerts = {
  reviewCount: number;
  noAdministratorCount: number;
  /** Mês mais antigo com parcela da empresa ainda não paga (antes do atual), e quantas são. */
  overdue: { month: string; count: number } | null;
};

export async function getManagerAlerts(organizationId: string): Promise<ManagerAlerts> {
  const currentMonth = brazilMonthKey();
  const [reviewCount, noAdministratorCount, overdueRows] = await Promise.all([
    prisma.commissionSale.count({ where: { organizationId, status: "REVIEW" } }),
    prisma.commissionSale.count({ where: { organizationId, status: { in: ["ACTIVE", "REVIEW"] }, administratorId: null } }),
    prisma.commissionEntry.groupBy({
      by: ["paymentMonth"],
      where: {
        organizationId,
        status: "SCHEDULED",
        paidByAdministrator: false,
        paymentMonth: { lt: currentMonth },
        ...VISIBLE_SALE,
      },
      _count: { _all: true },
      orderBy: { paymentMonth: "asc" },
    }),
  ]);
  const overdueCount = overdueRows.reduce((acc, r) => acc + r._count._all, 0);
  return {
    reviewCount,
    noAdministratorCount,
    overdue: overdueRows.length > 0 ? { month: overdueRows[0].paymentMonth, count: overdueCount } : null,
  };
}

export type SaleListItem = {
  id: string;
  dealId: string | null;
  source: "CRM" | "LEGACY" | "MANUAL";
  status: "REVIEW" | "ACTIVE" | "CANCELLED";
  clientName: string;
  sellerId: string;
  sellerName: string;
  administratorId: string | null;
  administratorName: string | null;
  modality: "FULL" | "REDUCED";
  creditType: string | null;
  saleDate: string;
  netValue: number | null;
  grossValue: number | null;
  clientInstallment: number | null;
  quotaNumber: string | null;
  groupNumber: string | null;
  notes: string | null;
  /** Soma das parcelas não canceladas (todas as pessoas). */
  commissionTotal: number;
  /** O que a corretora recebe da administradora por esta venda (null = não dá pra saber). */
  revenueTotal: number | null;
  /** Parte da comissão que sai do caixa da corretora (fora o que a administradora paga direto). */
  commissionPaidByCompany: number;
  paidCount: number;
  problems: string[];
};

export type SaleFilter = "atencao" | "conferir" | "todas" | "canceladas";

/**
 * Lista de vendas pra tela do Financeiro. "Precisa de atenção" é calculado
 * na hora pelo próprio motor (sem administradora, sem regra, sem valor) —
 * nunca um campo gravado que poderia ficar desatualizado.
 */
export async function getSalesList(
  organizationId: string,
  filter: SaleFilter,
  search: string,
  opts?: { id?: string },
): Promise<SaleListItem[]> {
  const q = search.trim();
  const where = {
    organizationId,
    // Uma venda específica (link vindo da mesa do mês): qualquer status.
    ...(opts?.id
      ? { id: opts.id }
      : filter === "conferir"
      ? { status: "REVIEW" as const }
      : filter === "canceladas"
        ? { status: "CANCELLED" as const }
        : { status: { in: ["ACTIVE" as const, "REVIEW" as const] } }),
    ...(q && !opts?.id
      ? {
          OR: [
            { clientName: { contains: q, mode: "insensitive" as const } },
            { seller: { name: { contains: q, mode: "insensitive" as const } } },
            { quotaNumber: { contains: q } },
          ],
        }
      : {}),
  };

  // Mesma transação pra lista + contexto do motor (regras/administradoras).
  const { sales, ctx } = await prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, organizationId);
    const sales = await tx.commissionSale.findMany({
      where,
      orderBy: { saleDate: "desc" },
      take: filter === "atencao" ? 1000 : 300,
      select: {
        id: true,
        organizationId: true,
        dealId: true,
        source: true,
        status: true,
        clientName: true,
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
        quotaNumber: true,
        groupNumber: true,
        notes: true,
        seller: { select: { name: true } },
        administrator: { select: { name: true } },
        entries: { where: { status: { not: "CANCELLED" } }, select: { amount: true, status: true, paidByAdministrator: true } },
        revenues: { select: { amount: true } },
      },
    });
    const ctx = await loadEngineContext(tx, organizationId);
    return { sales, ctx };
  });

  const items = sales.map((s) => {
    const problems =
      s.status === "CANCELLED"
        ? []
        : buildSaleSchedule(toSaleLike(s), s.administratorId ? (ctx.administrators.get(s.administratorId) ?? null) : null, ctx.rules).problems.map(
            problemLabel,
          );
    return {
      id: s.id,
      dealId: s.dealId,
      source: s.source,
      status: s.status,
      clientName: s.clientName,
      sellerId: s.sellerId,
      sellerName: s.seller.name,
      administratorId: s.administratorId,
      administratorName: s.administrator?.name ?? null,
      modality: s.modality,
      creditType: s.creditType,
      saleDate: s.saleDate.toISOString(),
      netValue: s.netValue != null ? Number(s.netValue) : null,
      grossValue: s.grossValue != null ? Number(s.grossValue) : null,
      clientInstallment: s.clientInstallment != null ? Number(s.clientInstallment) : null,
      quotaNumber: s.quotaNumber,
      groupNumber: s.groupNumber,
      notes: s.notes,
      commissionTotal: s.entries.reduce((acc, e) => acc + Number(e.amount), 0),
      revenueTotal: s.revenues.length > 0 ? s.revenues.reduce((acc, r) => acc + Number(r.amount), 0) : null,
      commissionPaidByCompany: s.entries.filter((e) => !e.paidByAdministrator).reduce((acc, e) => acc + Number(e.amount), 0),
      paidCount: s.entries.filter((e) => e.status === "PAID").length,
      problems: Array.from(new Set(problems)),
    };
  });

  return filter === "atencao" && !opts?.id ? items.filter((s) => s.problems.length > 0 || s.status === "REVIEW").slice(0, 300) : items;
}

/** Parcelas de uma venda (todas as pessoas, todos os status) — painel da venda. */
export async function getSaleEntries(organizationId: string, saleId: string): Promise<EntryView[]> {
  const rows = await prisma.commissionEntry.findMany({
    where: { organizationId, saleId },
    select: ENTRY_SELECT,
    orderBy: [{ role: "asc" }, { kind: "asc" }, { installmentNumber: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toEntryView);
}

/** Meses mostrados no seletor do Financeiro: do mais antigo com lançamento até 12 meses à frente. */
export async function getMonthRange(organizationId: string): Promise<{ first: string; last: string }> {
  const current = brazilMonthKey();
  const oldest = await prisma.commissionEntry.findFirst({
    where: { organizationId },
    orderBy: { paymentMonth: "asc" },
    select: { paymentMonth: true },
  });
  const first = oldest && oldest.paymentMonth < current ? oldest.paymentMonth : current;
  return { first, last: addMonths(current, 24) };
}

export type OpenDispute = {
  id: string;
  message: string;
  createdAt: string;
  requesterName: string;
  entry: { amount: number; paymentMonth: string; clientName: string | null; saleId: string | null; what: string };
};

/** Contestações esperando resposta (mesa do Financeiro), mais antigas primeiro. */
export async function getOpenDisputes(organizationId: string): Promise<OpenDispute[]> {
  const rows = await prisma.commissionDispute.findMany({
    where: { organizationId, status: "OPEN" },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: {
      id: true,
      message: true,
      createdAt: true,
      requester: { select: { name: true } },
      entry: {
        select: {
          amount: true,
          paymentMonth: true,
          saleId: true,
          kind: true,
          installmentNumber: true,
          installmentCount: true,
          sale: { select: { clientName: true } },
        },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    message: r.message,
    createdAt: r.createdAt.toISOString(),
    requesterName: r.requester.name,
    entry: {
      amount: Number(r.entry.amount),
      paymentMonth: r.entry.paymentMonth,
      clientName: r.entry.sale?.clientName ?? null,
      saleId: r.entry.saleId,
      what:
        r.entry.kind === "ADJUSTMENT"
          ? "ajuste"
          : r.entry.installmentCount && r.entry.installmentCount > 1
            ? `parcela ${r.entry.installmentNumber} de ${r.entry.installmentCount}`
            : "parcela única",
    },
  }));
}

/** Por mês da venda: vendido, comissão gerada, o que a corretora recebe (0 = não informado). */
export type CommissionWeight = { month: string; sold: number; commission: number; revenue: number; commissionByCompany: number }[];

/**
 * "Quanto a comissão pesa" — por mês da VENDA: quanto foi vendido (valor
 * líquido das vendas de comissão ativas) e quanto de comissão essas vendas
 * geraram (todas as parcelas, de todo mundo, mesmo as que ainda vão ser
 * pagas). SQL direto pra agrupar por mês no fuso de Campo Grande — com
 * tenant na transação (RLS: sem isso a consulta crua voltaria vazia).
 */
export async function getCommissionWeight(organizationId: string, months = 6): Promise<CommissionWeight> {
  const since = addMonths(brazilMonthKey(), -(months - 1));
  const rows = await prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, organizationId);
    return tx.$queryRawUnsafe<{ month: string; sold: number | null; commission: number | null; revenue: number | null; byCompany: number | null }[]>(
      `SELECT to_char((s."saleDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Campo_Grande', 'YYYY-MM') AS month,
              SUM(s."netValue")::float AS sold,
              COALESCE(SUM(e.total), 0)::float AS commission,
              COALESCE(SUM(e."byCompany"), 0)::float AS "byCompany",
              COALESCE(SUM(r.total), 0)::float AS revenue
         FROM "CommissionSale" s
         LEFT JOIN (
           SELECT "saleId", SUM(amount) AS total, SUM(CASE WHEN "paidByAdministrator" THEN 0 ELSE amount END) AS "byCompany"
             FROM "CommissionEntry"
            WHERE kind = 'INSTALLMENT' AND status <> 'CANCELLED' AND "organizationId" = $1
            GROUP BY "saleId"
         ) e ON e."saleId" = s.id
         LEFT JOIN (
           SELECT "saleId", SUM(amount) AS total
             FROM "CommissionRevenue"
            WHERE "organizationId" = $1
            GROUP BY "saleId"
         ) r ON r."saleId" = s.id
        WHERE s."organizationId" = $1 AND s.status = 'ACTIVE' AND s."saleDate" >= $2
        GROUP BY 1
        ORDER BY 1`,
      organizationId,
      brazilDateStringToUTC(`${since}-01`),
    );
  });
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  return Array.from({ length: months }, (_, i) => addMonths(since, i)).map((month) => ({
    month,
    sold: byMonth.get(month)?.sold ?? 0,
    commission: byMonth.get(month)?.commission ?? 0,
    revenue: byMonth.get(month)?.revenue ?? 0,
    commissionByCompany: byMonth.get(month)?.byCompany ?? 0,
  }));
}

/** Quanto a corretora espera receber das administradoras num mês de pagamento (vendas ativas). */
export async function getExpectedRevenue(organizationId: string, month: string): Promise<number> {
  const result = await prisma.commissionRevenue.aggregate({
    where: { organizationId, paymentMonth: month, sale: { status: "ACTIVE" } },
    _sum: { amount: true },
  });
  return Number(result._sum.amount ?? 0);
}
