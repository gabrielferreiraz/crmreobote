/**
 * Leituras das telas de Comissões — formato já serializável (número, não
 * Decimal; string, não Date) pra passar direto pros componentes de cliente.
 */

import { prismaRaw } from "@/lib/prisma";
import { addMonths, brazilMonthKey, buildSaleSchedule, problemLabel, resolveAdministrator, type BeneficiaryRole } from "@/lib/commissions/engine";
import { loadEngineContext, toSaleLike } from "@/lib/commissions/sync";
import { setTenantOnTx } from "@/lib/tenant-context";
import { Prisma } from "@/app/generated/prisma/client";
import { searchCommissionSaleIds } from "@/lib/commissions/search";
import { brazilDateStringToUTC } from "@/lib/timezone";
import { clientPaymentState, type ClientPaymentState } from "@/lib/commissions/client-payment";

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
  /** O cliente pagou a parcela do mês desta comissão? (ver lib/commissions/client-payment.ts) */
  clientPayment: ClientPaymentState;
  /** Efeito do "cliente não pagou" já aplicado nesta parcela (travou / perdeu / passou pro mês seguinte). */
  clientPaymentEffect: "HOLD" | "FORFEIT" | "DEFER" | null;
  /** Mês original quando a parcela foi empurrada pro mês seguinte. */
  deferredFromMonth: string | null;
};

/** Só parcela de venda conferida (ativa) ou ajuste avulso — "a conferir" e cancelada não aparecem pra ninguém fora da tela da venda. */

/** Uma linha do SELECT único de parcelas (ver loadEntries). */
type RawEntryRow = {
  id: string;
  saleId: string | null;
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
  percent: number | null;
  clientPaymentEffect: "IGNORE" | "HOLD" | "FORFEIT" | "DEFER" | null;
  deferredFromMonth: string | null;
  beneficiaryId: string;
  beneficiaryName: string;
  ruleBase: "NET" | "GROSS" | "COMPANY_REVENUE" | null;
  disputeStatus: "OPEN" | "RESOLVED" | null;
  disputeMessage: string | null;
  disputeResponse: string | null;
  disputeCreatedAt: Date | null;
  clientName: string | null;
  dealId: string | null;
  saleDate: Date | null;
  modality: "FULL" | "REDUCED" | null;
  netValue: number | null;
  grossValue: number | null;
  autoDebit: boolean | null;
  administratorName: string | null;
  unpaidPolicy: "IGNORE" | "HOLD" | "FORFEIT" | "DEFER" | null;
  revenueTotal: number | null;
  clientPaid: boolean | null;
};

/** Parcela "visível": ajuste avulso ou de venda conferida; cancelada só quando foi perdida (cliente não pagou). */
const VISIBLE_ENTRY_SQL = Prisma.sql`(e."saleId" IS NULL OR s.status = 'ACTIVE') AND (e.status <> 'CANCELLED' OR e."clientPaymentEffect" = 'FORFEIT')`;

/**
 * As parcelas numa consulta SQL SÓ (JOIN de pessoa, regra, venda,
 * administradora, contestação mais recente, receita da venda e o ✓ do
 * cliente no mês da parcela). Pelo Prisma eram 8 consultas em sequência
 * (uma por relação, ~25 ms cada ida ao banco) — era o grosso do tempo da
 * mesa do mês, da "Minha comissão" e do painel da venda. Transação com o
 * tenant: SQL cru sem ele voltaria vazio (RLS), sem erro.
 */
async function loadEntries(organizationId: string, filter: Prisma.Sql, orderBy: Prisma.Sql): Promise<EntryView[]> {
  const rows = await prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, organizationId);
    return tx.$queryRaw<RawEntryRow[]>`
      SELECT e.id, e."saleId", e.role::text AS role, e.kind::text AS kind, e."installmentNumber", e."installmentCount",
             e."paymentMonth", e.amount::float8 AS amount, e.status::text AS status, e."paidByAdministrator",
             e."holdReason", e.note, e.percent::float8 AS percent, e."clientPaymentEffect"::text AS "clientPaymentEffect",
             e."deferredFromMonth", e."beneficiaryId", u.name AS "beneficiaryName", r.base::text AS "ruleBase",
             d.status::text AS "disputeStatus", d.message AS "disputeMessage", d.response AS "disputeResponse",
             d."createdAt" AS "disputeCreatedAt",
             s."clientName", s."dealId", s."saleDate", s.modality::text AS modality, s."netValue"::float8 AS "netValue",
             s."grossValue"::float8 AS "grossValue", s."autoDebit",
             a.name AS "administratorName", a."unpaidPolicy"::text AS "unpaidPolicy",
             (SELECT SUM(rv.amount)::float8 FROM "CommissionRevenue" rv WHERE rv."saleId" = e."saleId") AS "revenueTotal",
             (SELECT cp.paid FROM "CommissionClientPayment" cp WHERE cp."saleId" = e."saleId" AND cp.month = e."paymentMonth") AS "clientPaid"
        FROM "CommissionEntry" e
        JOIN "User" u ON u.id = e."beneficiaryId"
        LEFT JOIN "CommissionRule" r ON r.id = e."ruleId"
        LEFT JOIN "CommissionSale" s ON s.id = e."saleId"
        LEFT JOIN "ConsortiumAdministrator" a ON a.id = s."administratorId"
        LEFT JOIN LATERAL (
          SELECT dd.status, dd.message, dd.response, dd."createdAt"
            FROM "CommissionDispute" dd
           WHERE dd."entryId" = e.id
           ORDER BY dd."createdAt" DESC
           LIMIT 1
        ) d ON true
       WHERE e."organizationId" = ${organizationId} AND ${filter}
       ORDER BY ${orderBy}`;
  });
  return rows.map(rawToEntryView);
}

function rawToEntryView(e: RawEntryRow): EntryView {
  const base =
    e.ruleBase === "COMPANY_REVENUE" ? (e.revenueTotal ?? 0) : e.ruleBase ? ((e.ruleBase === "GROSS" ? e.grossValue : e.netValue) ?? 0) : 0;
  const hasSale = e.saleId != null && e.clientName != null;
  return {
    id: e.id,
    saleId: e.saleId,
    clientName: e.clientName,
    administratorName: e.administratorName,
    role: e.role,
    kind: e.kind,
    installmentNumber: e.installmentNumber,
    installmentCount: e.installmentCount,
    paymentMonth: e.paymentMonth,
    amount: e.amount,
    status: e.status,
    paidByAdministrator: e.paidByAdministrator,
    holdReason: e.holdReason,
    note: e.note,
    beneficiaryId: e.beneficiaryId,
    beneficiaryName: e.beneficiaryName,
    dealId: e.dealId,
    saleDate: e.saleDate ? e.saleDate.toISOString() : null,
    modality: e.modality,
    percent: e.percent,
    baseValue: hasSale && e.ruleBase && base > 0 ? base : null,
    baseKind: e.ruleBase,
    dispute:
      e.disputeStatus && e.disputeMessage && e.disputeCreatedAt
        ? { status: e.disputeStatus, message: e.disputeMessage, response: e.disputeResponse, createdAt: e.disputeCreatedAt.toISOString() }
        : null,
    clientPayment:
      e.kind === "ADJUSTMENT"
        ? "NOT_REQUIRED"
        : clientPaymentState({ hasSale, policy: e.unpaidPolicy, autoDebit: e.autoDebit ?? false, paid: e.clientPaid }),
    clientPaymentEffect: e.clientPaymentEffect === "IGNORE" ? null : e.clientPaymentEffect,
    deferredFromMonth: e.deferredFromMonth,
  };
}

/** "Minha comissão": do primeiro mês visível em diante, nunca de outra pessoa. */
export async function getMyCommissionEntries(organizationId: string, userId: string, fromMonth: string): Promise<EntryView[]> {
  return loadEntries(
    organizationId,
    Prisma.sql`e."beneficiaryId" = ${userId} AND e."paymentMonth" >= ${fromMonth} AND ${VISIBLE_ENTRY_SQL}`,
    Prisma.sql`e."paymentMonth" ASC, e."createdAt" ASC`,
  );
}

/** Tudo de um mês (Financeiro). */
export async function getMonthEntries(organizationId: string, month: string): Promise<EntryView[]> {
  return loadEntries(organizationId, Prisma.sql`e."paymentMonth" = ${month} AND ${VISIBLE_ENTRY_SQL}`, Prisma.sql`e."createdAt" ASC`);
}

export type ManagerAlerts = {
  reviewCount: number;
  noAdministratorCount: number;
  /** Mês mais antigo com parcela da empresa ainda não paga (antes do atual), e quantas são. */
  overdue: { month: string; count: number } | null;
};

export type ManagerOverview = {
  started: boolean;
  payDay: number;
  administratorsCount: number;
  rulesCount: number;
  /** Seletor de mês: do mais antigo com lançamento até 24 meses à frente. */
  range: { first: string; last: string };
  /** O que as administradoras devem pagar pra corretora no mês (vendas ativas). */
  expectedRevenue: number;
  alerts: ManagerAlerts;
};

/**
 * Tudo que é "número pequeno" da mesa do mês numa consulta SÓ: configuração,
 * contagens, intervalo de meses, receita prevista e os avisos. Eram 6
 * consultas soltas disparadas juntas — cada uma abrindo a própria conexão.
 */
export async function getManagerOverview(organizationId: string, month: string): Promise<ManagerOverview> {
  const current = brazilMonthKey();
  const [row] = await inTenantTx(organizationId, (tx) =>
    tx.$queryRaw<
      {
        started: boolean;
        payDay: number | null;
        administratorsCount: number;
        rulesCount: number;
        oldestMonth: string | null;
        expectedRevenue: number | null;
        reviewCount: number;
        noAdministratorCount: number;
        overdueMonth: string | null;
        overdueCount: number;
      }[]
    >`
      SELECT
        (o."commissionStartDate" IS NOT NULL) AS started,
        o."commissionPayDay" AS "payDay",
        (SELECT COUNT(*) FROM "ConsortiumAdministrator" WHERE "organizationId" = o.id AND active)::int AS "administratorsCount",
        (SELECT COUNT(*) FROM "CommissionRule" WHERE "organizationId" = o.id AND active)::int AS "rulesCount",
        (SELECT MIN("paymentMonth") FROM "CommissionEntry" WHERE "organizationId" = o.id) AS "oldestMonth",
        (SELECT SUM(rv.amount)::float8 FROM "CommissionRevenue" rv JOIN "CommissionSale" s ON s.id = rv."saleId"
          WHERE rv."organizationId" = o.id AND rv."paymentMonth" = ${month} AND s.status = 'ACTIVE') AS "expectedRevenue",
        (SELECT COUNT(*) FROM "CommissionSale" WHERE "organizationId" = o.id AND status = 'REVIEW')::int AS "reviewCount",
        (SELECT COUNT(*) FROM "CommissionSale"
          WHERE "organizationId" = o.id AND status IN ('ACTIVE', 'REVIEW') AND "administratorId" IS NULL)::int AS "noAdministratorCount",
        od."overdueMonth", od."overdueCount"
      FROM "Organization" o
      CROSS JOIN LATERAL (
        SELECT MIN(e."paymentMonth") AS "overdueMonth", COUNT(*)::int AS "overdueCount"
          FROM "CommissionEntry" e
          LEFT JOIN "CommissionSale" s ON s.id = e."saleId"
         WHERE e."organizationId" = o.id AND e.status = 'SCHEDULED' AND e."paidByAdministrator" = false
           AND e."paymentMonth" < ${current} AND (e."saleId" IS NULL OR s.status = 'ACTIVE')
      ) od
      WHERE o.id = ${organizationId}`,
  );
  const oldest = row?.oldestMonth ?? null;
  return {
    started: row?.started ?? false,
    payDay: row?.payDay ?? 10,
    administratorsCount: row?.administratorsCount ?? 0,
    rulesCount: row?.rulesCount ?? 0,
    range: { first: oldest && oldest < current ? oldest : current, last: addMonths(current, 24) },
    expectedRevenue: row?.expectedRevenue ?? 0,
    alerts: {
      reviewCount: row?.reviewCount ?? 0,
      noAdministratorCount: row?.noAdministratorCount ?? 0,
      overdue: row?.overdueMonth ? { month: row.overdueMonth, count: row.overdueCount } : null,
    },
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
  autoDebit: boolean;
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

/** Quantas vendas a lista mostra de uma vez — o resto se acha pela busca/filtro (a tela avisa). */
export const SALES_LIST_LIMIT = 300;

export type SalesListResult = {
  items: SaleListItem[];
  /** Quantas vendas batem com o filtro no total (pode ser mais que as mostradas). */
  total: number;
};

type Tx = Prisma.TransactionClient;
type EngineCtx = Awaited<ReturnType<typeof loadEngineContext>>;

const STATUS_WHERE: Record<SaleFilter, Prisma.CommissionSaleWhereInput> = {
  atencao: { status: { in: ["ACTIVE", "REVIEW"] } },
  conferir: { status: "REVIEW" },
  todas: { status: { in: ["ACTIVE", "REVIEW"] } },
  canceladas: { status: "CANCELLED" },
};

/** Só o que o motor precisa pra dizer se a venda tem problema. */
const SALE_ENGINE_SELECT = {
  id: true,
  organizationId: true,
  status: true,
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

/** "Falta administradora / regra / valor" — calculado na hora pelo próprio motor, nunca um campo gravado que poderia ficar velho. */
function saleProblems(sale: Parameters<typeof toSaleLike>[0], ctx: EngineCtx): string[] {
  if (sale.status === "CANCELLED") return [];
  const base = sale.administratorId ? ctx.administrators.get(sale.administratorId) : undefined;
  const administrator = base ? resolveAdministrator(base, sale.creditType) : null;
  return Array.from(new Set(buildSaleSchedule(toSaleLike(sale), administrator, ctx.rules).problems.map(problemLabel)));
}

/**
 * Ids (mais recentes primeiro) das vendas que precisam de atenção: a
 * conferir, ou com algum problema. Olha a base INTEIRA com poucos campos —
 * antes eram só as 1.000 mais recentes, e uma venda antiga com problema
 * sumia da lista (e do contador) conforme a base crescia.
 */
async function idsNeedingAttention(tx: Tx, where: Prisma.CommissionSaleWhereInput, ctx: EngineCtx): Promise<string[]> {
  const rows = await tx.commissionSale.findMany({ where, select: SALE_ENGINE_SELECT, orderBy: { saleDate: "desc" } });
  return rows.filter((r) => r.status === "REVIEW" || saleProblems(r, ctx).length > 0).map((r) => r.id);
}

async function inTenantTx<T>(organizationId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prismaRaw.$transaction(
    async (tx) => {
      await setTenantOnTx(tx, organizationId);
      return fn(tx);
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

/** Quantas vendas precisam de atenção (o número na aba) — sem busca, com o filtro de vendedor. */
export async function countSalesNeedingAttention(organizationId: string, sellerId?: string): Promise<number> {
  return inTenantTx(organizationId, async (tx) => {
    const ctx = await loadEngineContext(tx, organizationId);
    const where = { organizationId, ...STATUS_WHERE.atencao, ...(sellerId ? { sellerId } : {}) };
    return (await idsNeedingAttention(tx, where, ctx)).length;
  });
}

/**
 * Lista de vendas pra tela do Financeiro (até SALES_LIST_LIMIT, mais
 * recentes primeiro) e o total que bate com o filtro. A busca ignora acento
 * (ver lib/commissions/search.ts).
 */
export async function getSalesList(
  organizationId: string,
  filter: SaleFilter,
  search: string,
  opts?: { id?: string; sellerId?: string },
): Promise<SalesListResult> {
  // Em paralelo (conexões separadas): o cadastro do motor e a escolha de
  // QUAIS vendas mostrar. Antes era tudo numa fila só (~11 idas ao banco).
  const [ctx, picked] = await Promise.all([
    inTenantTx(organizationId, (tx) => loadEngineContext(tx, organizationId)),
    inTenantTx(organizationId, async (tx) => {
      let where: Prisma.CommissionSaleWhereInput;
      if (opts?.id) {
        // Uma venda específica (link vindo da mesa do mês): qualquer status.
        where = { organizationId, id: opts.id };
      } else {
        const ids = search.trim() ? await searchCommissionSaleIds(tx, organizationId, search) : null;
        where = {
          organizationId,
          ...STATUS_WHERE[filter],
          ...(opts?.sellerId ? { sellerId: opts.sellerId } : {}),
          ...(ids ? { id: { in: ids } } : {}),
        };
      }
      const orderBy = [{ saleDate: "desc" as const }, { id: "desc" as const }];
      // "Pendentes" olha a base INTEIRA (poucos campos) — é o motor que diz o que tem problema.
      const wholeBase = filter === "atencao" && !opts?.id;
      const rows = await tx.commissionSale.findMany({ where, select: SALE_ENGINE_SELECT, orderBy, ...(wholeBase ? {} : { take: SALES_LIST_LIMIT }) });
      const total = wholeBase ? null : opts?.id ? rows.length : await tx.commissionSale.count({ where });
      // Base pequena: já traz os detalhes de todas nesta mesma ida (evita uma
      // terceira etapa esperando as duas primeiras).
      const details = rows.length <= EAGER_DETAILS_LIMIT ? await loadSaleDetails(tx, organizationId, rows.map((r) => r.id)) : null;
      return { rows, total, details };
    }),
  ]);

  const withProblems = picked.rows.map((row) => ({ row, problems: saleProblems(row, ctx) }));
  const chosen =
    filter === "atencao" && !opts?.id ? withProblems.filter((x) => x.row.status === "REVIEW" || x.problems.length > 0) : withProblems;
  const total = picked.total ?? chosen.length;
  const page = chosen.slice(0, SALES_LIST_LIMIT);
  if (page.length === 0) return { items: [], total };

  const details =
    picked.details ?? (await inTenantTx(organizationId, (tx) => loadSaleDetails(tx, organizationId, page.map((x) => x.row.id))));
  const byId = new Map(details.map((d) => [d.id, d]));

  const items: SaleListItem[] = page.flatMap(({ row: s, problems }) => {
    const d = byId.get(s.id);
    if (!d) return [];
    return [
      {
        id: s.id,
        dealId: d.dealId,
        source: d.source,
        status: s.status,
        clientName: d.clientName,
        sellerId: s.sellerId,
        sellerName: d.sellerName,
        administratorId: s.administratorId,
        administratorName: d.administratorName,
        modality: s.modality,
        creditType: s.creditType,
        saleDate: s.saleDate.toISOString(),
        netValue: s.netValue != null ? Number(s.netValue) : null,
        grossValue: s.grossValue != null ? Number(s.grossValue) : null,
        clientInstallment: s.clientInstallment != null ? Number(s.clientInstallment) : null,
        autoDebit: d.autoDebit,
        quotaNumber: d.quotaNumber,
        groupNumber: d.groupNumber,
        notes: d.notes,
        commissionTotal: d.commissionTotal,
        revenueTotal: d.revenueTotal,
        commissionPaidByCompany: d.byCompany,
        paidCount: d.paidCount,
        problems,
      },
    ];
  });
  return { items, total };
}

/** Até quantas vendas candidatas os detalhes vêm junto, numa ida só. */
const EAGER_DETAILS_LIMIT = 600;

/**
 * Detalhes das vendas mostradas numa consulta SÓ, com os totais de comissão
 * e receita já somados no banco (pelo Prisma eram 5 consultas, uma por relação).
 */
function loadSaleDetails(tx: Tx, organizationId: string, ids: string[]): Promise<RawSaleRow[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return tx.$queryRaw<RawSaleRow[]>`
      SELECT s.id, s."dealId", s.source::text AS source, s."clientName", s."autoDebit", s."quotaNumber", s."groupNumber", s.notes,
             u.name AS "sellerName", a.name AS "administratorName",
             COALESCE(en.total, 0)::float8 AS "commissionTotal", COALESCE(en."byCompany", 0)::float8 AS "byCompany",
             COALESCE(en.paid, 0)::int AS "paidCount", rv.total::float8 AS "revenueTotal"
        FROM "CommissionSale" s
        JOIN "User" u ON u.id = s."sellerId"
        LEFT JOIN "ConsortiumAdministrator" a ON a.id = s."administratorId"
        LEFT JOIN LATERAL (
          SELECT SUM(amount) AS total,
                 SUM(CASE WHEN "paidByAdministrator" THEN 0 ELSE amount END) AS "byCompany",
                 COUNT(*) FILTER (WHERE status = 'PAID') AS paid
            FROM "CommissionEntry" WHERE "saleId" = s.id AND status <> 'CANCELLED'
        ) en ON true
        LEFT JOIN LATERAL (SELECT SUM(amount) AS total FROM "CommissionRevenue" WHERE "saleId" = s.id) rv ON true
       WHERE s."organizationId" = ${organizationId} AND s.id IN (${Prisma.join(ids)})`;
}

type RawSaleRow = {
  id: string;
  dealId: string | null;
  source: "CRM" | "LEGACY" | "MANUAL";
  clientName: string;
  autoDebit: boolean;
  quotaNumber: string | null;
  groupNumber: string | null;
  notes: string | null;
  sellerName: string;
  administratorName: string | null;
  commissionTotal: number;
  byCompany: number;
  paidCount: number;
  revenueTotal: number | null;
};

/** Parcelas de uma venda (todas as pessoas, todos os status) — painel da venda. */
export async function getSaleEntries(organizationId: string, saleId: string): Promise<EntryView[]> {
  return loadEntries(
    organizationId,
    Prisma.sql`e."saleId" = ${saleId}`,
    Prisma.sql`e.role ASC, e.kind ASC, e."installmentNumber" ASC NULLS LAST, e."createdAt" ASC`,
  );
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
  // Uma consulta só (pelo Prisma eram 4: contestação, pessoa, parcela, venda).
  const rows = await inTenantTx(organizationId, (tx) =>
    tx.$queryRaw<
      {
        id: string;
        message: string;
        createdAt: Date;
        requesterName: string;
        amount: number;
        paymentMonth: string;
        saleId: string | null;
        kind: "INSTALLMENT" | "ADJUSTMENT";
        installmentNumber: number | null;
        installmentCount: number | null;
        clientName: string | null;
      }[]
    >`
      SELECT d.id, d.message, d."createdAt", u.name AS "requesterName",
             e.amount::float8 AS amount, e."paymentMonth", e."saleId", e.kind::text AS kind, e."installmentNumber", e."installmentCount",
             s."clientName"
        FROM "CommissionDispute" d
        JOIN "User" u ON u.id = d."requesterId"
        JOIN "CommissionEntry" e ON e.id = d."entryId"
        LEFT JOIN "CommissionSale" s ON s.id = e."saleId"
       WHERE d."organizationId" = ${organizationId} AND d.status = 'OPEN'
       ORDER BY d."createdAt" ASC
       LIMIT 100`,
  );
  return rows.map((r) => ({
    id: r.id,
    message: r.message,
    createdAt: r.createdAt.toISOString(),
    requesterName: r.requesterName,
    entry: {
      amount: r.amount,
      paymentMonth: r.paymentMonth,
      clientName: r.clientName,
      saleId: r.saleId,
      what:
        r.kind === "ADJUSTMENT"
          ? "ajuste"
          : r.installmentCount && r.installmentCount > 1
            ? `parcela ${r.installmentNumber} de ${r.installmentCount}`
            : "parcela única",
    },
  }));
}

/** Por mês da venda: vendido, comissão gerada, o que a corretora recebe (0 = não informado). */
export type CommissionWeight = {
  month: string;
  sold: number;
  commission: number;
  revenue: number;
  commissionByCompany: number;
  /** Comissão paga pela empresa SÓ nas vendas em que se sabe o que a corretora recebe — é com ela que "quanto fica" é calculado. */
  commissionByCompanyKnown: number;
  /** Vendas do mês sem o "quanto a administradora paga" cadastrado (ficam fora do "quanto fica"). */
  salesWithoutRevenue: number;
}[];

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
    return tx.$queryRawUnsafe<
      { month: string; sold: number | null; commission: number | null; revenue: number | null; byCompany: number | null; byCompanyKnown: number | null; withoutRevenue: number }[]
    >(
      `SELECT to_char((s."saleDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Campo_Grande', 'YYYY-MM') AS month,
              SUM(s."netValue")::float AS sold,
              COALESCE(SUM(e.total), 0)::float AS commission,
              COALESCE(SUM(e."byCompany"), 0)::float AS "byCompany",
              COALESCE(SUM(CASE WHEN r.total IS NOT NULL THEN e."byCompany" END), 0)::float AS "byCompanyKnown",
              COUNT(*) FILTER (WHERE r.total IS NULL)::int AS "withoutRevenue",
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
    commissionByCompanyKnown: byMonth.get(month)?.byCompanyKnown ?? 0,
    salesWithoutRevenue: byMonth.get(month)?.withoutRevenue ?? 0,
  }));
}

export type ClientPaymentRow = {
  saleId: string;
  clientName: string;
  sellerName: string;
  administratorName: string | null;
  policy: "HOLD" | "FORFEIT" | "DEFER";
  groupNumber: string | null;
  quotaNumber: string | null;
  clientInstallment: number | null;
  autoDebit: boolean;
  /** O ✓ do mês: true pagou, false não pagou, null ainda não conferido. */
  paid: boolean | null;
  /** Comissão (de todo mundo) que depende deste pagamento, no mês. */
  commission: number;
  /** Meses seguidos sem pagar até este (3+ = caso de estorno, outro módulo). */
  unpaidStreak: number;
};

/**
 * "Quem pagou a parcela" de um mês: toda venda ativa cuja comissão daquele
 * mês depende do pagamento do cliente (administradora com regra diferente de
 * "não precisa conferir"). Inclui a venda cuja parcela foi empurrada pra
 * frente por "não pagou" — pra dar pra desfazer.
 */
export async function getClientPaymentRows(organizationId: string, month: string): Promise<ClientPaymentRow[]> {
  // Uma consulta só (pelo Prisma eram 5: venda, vendedor, administradora, ✓ e parcelas).
  const rows = await inTenantTx(organizationId, (tx) =>
    tx.$queryRaw<
      {
        saleId: string;
        clientName: string;
        groupNumber: string | null;
        quotaNumber: string | null;
        clientInstallment: number | null;
        autoDebit: boolean;
        sellerName: string;
        administratorName: string;
        policy: "HOLD" | "FORFEIT" | "DEFER";
        commission: number;
        history: { month: string; paid: boolean }[];
      }[]
    >`
      SELECT s.id AS "saleId", s."clientName", s."groupNumber", s."quotaNumber", s."clientInstallment"::float8 AS "clientInstallment",
             s."autoDebit", u.name AS "sellerName", a.name AS "administratorName", a."unpaidPolicy"::text AS policy,
             COALESCE(en.total, 0)::float8 AS commission,
             COALESCE(cp.history, '[]'::json) AS history
        FROM "CommissionSale" s
        JOIN "User" u ON u.id = s."sellerId"
        JOIN "ConsortiumAdministrator" a ON a.id = s."administratorId"
        LEFT JOIN LATERAL (
          SELECT SUM(amount) AS total, COUNT(*) AS n
            FROM "CommissionEntry"
           WHERE "saleId" = s.id AND kind = 'INSTALLMENT' AND ("paymentMonth" = ${month} OR "deferredFromMonth" = ${month})
        ) en ON true
        LEFT JOIN LATERAL (
          -- Últimos 12 meses até este: o ✓ do mês e a sequência de "não pagou".
          SELECT json_agg(json_build_object('month', x.month, 'paid', x.paid) ORDER BY x.month DESC) AS history
            FROM (SELECT month, paid FROM "CommissionClientPayment" WHERE "saleId" = s.id AND month <= ${month} ORDER BY month DESC LIMIT 12) x
        ) cp ON true
       WHERE s."organizationId" = ${organizationId} AND s.status = 'ACTIVE' AND a."unpaidPolicy" <> 'IGNORE'
         AND (en.n > 0 OR EXISTS (SELECT 1 FROM "CommissionClientPayment" c2 WHERE c2."saleId" = s.id AND c2.month = ${month}))
       ORDER BY s."clientName" ASC
       LIMIT 2000`,
  );
  return rows.map((r) => ({
    saleId: r.saleId,
    clientName: r.clientName,
    sellerName: r.sellerName,
    administratorName: r.administratorName,
    policy: r.policy,
    groupNumber: r.groupNumber,
    quotaNumber: r.quotaNumber,
    clientInstallment: r.clientInstallment,
    autoDebit: r.autoDebit,
    paid: r.history.find((c) => c.month === month)?.paid ?? null,
    commission: r.commission,
    unpaidStreak: unpaidStreak(r.history, month),
  }));
}

/**
 * Quantos meses SEGUIDOS o cliente não pagou, terminando neste mês (ou no
 * anterior, se este ainda não foi conferido). `history` em ordem decrescente.
 */
function unpaidStreak(history: { month: string; paid: boolean }[], month: string): number {
  const byMonth = new Map(history.map((h) => [h.month, h.paid]));
  let cursor = byMonth.has(month) ? month : addMonths(month, -1);
  let streak = 0;
  while (byMonth.get(cursor) === false) {
    streak++;
    cursor = addMonths(cursor, -1);
  }
  return streak;
}
