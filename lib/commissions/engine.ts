/**
 * Núcleo de cálculo das comissões — funções PURAS (sem banco), testadas em
 * scripts/test-commission-engine.ts. Tudo que varia de corretora pra
 * corretora chega aqui como dado (administradora, regras); nada de regra de
 * negócio fixa no código.
 *
 * Dinheiro é calculado em CENTAVOS inteiros do começo ao fim — a última
 * parcela fica com a sobra do arredondamento, então a soma das parcelas
 * SEMPRE bate com o total (erro clássico de sistema de comissão: arredondar
 * cada parcela e perder/ganhar centavos no total).
 */

import { getBrazilParts } from "@/lib/timezone";

export type Modality = "FULL" | "REDUCED";
export type BeneficiaryRole = "SELLER" | "SUPERVISOR" | "MANAGER";
/** Sobre o que o % de uma regra é aplicado: valor líquido, bruto, ou "o que a corretora recebe". */
export type Base = "NET" | "GROSS" | "COMPANY_REVENUE";
/** Como a administradora calcula o que paga pra corretora (ver CommissionRevenueMode no schema). */
export type RevenueMode = "CREDIT_EQUAL" | "CREDIT_TABLE" | "CLIENT_INSTALLMENT_TABLE";

export const BENEFICIARY_ROLES: BeneficiaryRole[] = ["SELLER", "SUPERVISOR", "MANAGER"];

// ─── Meses ("YYYY-MM", calendário de Campo Grande) ─────────────────────

export function monthKey(year: number, monthIndex0: number): string {
  const total = year * 12 + monthIndex0;
  const y = Math.floor(total / 12);
  const m = total - y * 12;
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  return monthKey(y, m - 1 + n);
}

/** Mês civil (Campo Grande) de um instante. */
export function brazilMonthKey(date: Date = new Date()): string {
  const { year, month } = getBrazilParts(date);
  return monthKey(year, month);
}

export function isMonthKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/**
 * Mês a que a venda "pertence" pra comissão: o mês do fechamento, ou o
 * seguinte quando a administradora tem dia de corte e a venda caiu depois
 * dele.
 */
export function saleReferenceMonth(saleDate: Date, cutoffDay: number | null): string {
  const { year, month, day } = getBrazilParts(saleDate);
  const shift = cutoffDay != null && day > cutoffDay ? 1 : 0;
  return monthKey(year, month + shift);
}

export function firstPaymentMonth(saleDate: Date, cutoffDay: number | null, graceMonths: number): string {
  return addMonths(saleReferenceMonth(saleDate, cutoffDay), Math.max(0, graceMonths));
}

// ─── Divisão em parcelas ─────────────────────────────────────────────

/** Divide `totalCents` em `count` partes iguais; a última absorve a sobra (a soma bate sempre). */
export function splitCents(totalCents: number, count: number): number[] {
  const n = Math.max(1, Math.floor(count));
  return splitByWeights(totalCents, Array.from({ length: n }, () => 1));
}

/**
 * Divide `totalCents` na proporção dos pesos (ex.: o que a administradora
 * paga em cada parcela) — é assim que a comissão do consultor acompanha o
 * ritmo em que a corretora recebe. A última parte absorve a sobra do
 * arredondamento, então a soma é sempre exatamente o total. Pesos todos
 * zerados = partes iguais.
 */
export function splitByWeights(totalCents: number, weights: number[]): number[] {
  const n = Math.max(1, weights.length);
  const safe = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const sum = safe.reduce((a, b) => a + b, 0);
  const parts: number[] = [];
  let allocated = 0;
  for (let i = 0; i < n - 1; i++) {
    const share = sum > 0 ? Math.floor((totalCents * safe[i]) / sum) : Math.floor(totalCents / n);
    parts.push(share);
    allocated += share;
  }
  parts.push(totalCents - allocated);
  return parts;
}

/**
 * Validação do "quanto a administradora paga pra corretora" (cadastro).
 * Null = ok. Nunca exige "somar 100": é a tabela da administradora como ela
 * vem (ex.: 1,5% + 0,5% + … do crédito).
 */
export function revenueConfigError(
  mode: RevenueMode | null,
  count: number,
  totalPercent: number | null,
  percents: number[] | null,
): string | null {
  if (mode === null) return null;
  if (mode === "CREDIT_EQUAL") {
    if (totalPercent == null || !Number.isFinite(totalPercent) || totalPercent <= 0 || totalPercent > 100) {
      return "Digite quanto ela paga no total, em % do crédito";
    }
    return null;
  }
  if (!percents || percents.length !== count) return `Preencha o percentual das ${count} parcelas`;
  if (percents.some((p) => !Number.isFinite(p) || p < 0 || p > (mode === "CLIENT_INSTALLMENT_TABLE" ? 1000 : 100))) return "Algum percentual está inválido";
  if (!percents.some((p) => p > 0)) return "Pelo menos uma parcela precisa ter percentual";
  return null;
}

// ─── Escolha da regra ────────────────────────────────────────────────

export type RuleLike = {
  id: string;
  beneficiaryRole: BeneficiaryRole;
  userId: string | null;
  administratorId: string | null;
  modality: Modality | null;
  creditType: string | null;
  base: Base;
  percent: number;
  active: boolean;
  updatedAt: Date;
};

export type RuleContext = {
  role: BeneficiaryRole;
  userId: string;
  administratorId: string | null;
  modality: Modality;
  creditType: string | null;
};

/**
 * Peso de cada condição preenchida — potências de 2, então nunca empata
 * entre combinações diferentes: uma regra com PESSOA sempre vence uma sem,
 * não importa quantas outras condições a outra tenha. É a ordem que o
 * Financeiro espera ("o Fulano ganha X" é exceção que vale mais que a
 * tabela da administradora).
 */
export function ruleSpecificity(rule: Pick<RuleLike, "userId" | "administratorId" | "modality" | "creditType">): number {
  return (rule.userId ? 8 : 0) + (rule.administratorId ? 4 : 0) + (rule.modality ? 2 : 0) + (rule.creditType ? 1 : 0);
}

function sameText(a: string, b: string) {
  return a.trim().localeCompare(b.trim(), "pt-BR", { sensitivity: "base" }) === 0;
}

export function ruleMatches(rule: RuleLike, ctx: RuleContext): boolean {
  if (!rule.active || rule.beneficiaryRole !== ctx.role) return false;
  if (rule.userId && rule.userId !== ctx.userId) return false;
  if (rule.administratorId && rule.administratorId !== ctx.administratorId) return false;
  if (rule.modality && rule.modality !== ctx.modality) return false;
  if (rule.creditType && !(ctx.creditType && sameText(rule.creditType, ctx.creditType))) return false;
  return true;
}

/** A regra mais específica que serve; empate (mesmas condições) = a editada por último. */
export function pickRule<R extends RuleLike>(rules: R[], ctx: RuleContext): R | null {
  let best: R | null = null;
  for (const rule of rules) {
    if (!ruleMatches(rule, ctx)) continue;
    if (
      !best ||
      ruleSpecificity(rule) > ruleSpecificity(best) ||
      (ruleSpecificity(rule) === ruleSpecificity(best) && rule.updatedAt.getTime() > best.updatedAt.getTime())
    ) {
      best = rule;
    }
  }
  return best;
}

// ─── Cronograma de uma venda ─────────────────────────────────────────

/** O que fazer com a comissão quando o cliente não paga a parcela do mês (por administradora). */
export type UnpaidPolicy = "IGNORE" | "HOLD" | "FORFEIT" | "DEFER";

/** Tabela de comissão de uma administradora (padrão = creditType null, ou de uma categoria). */
export type CommissionTableLike = {
  creditType: string | null;
  commissionInstallments: number;
  /** Parcelas sem comissão (1 = primeira) — o calendário anda, só ela fica de fora. */
  skippedInstallments: number[];
  revenueMode: RevenueMode | null;
  revenueTotalPercent: number | null;
  revenuePercents: number[] | null;
  revenueBase: "NET" | "GROSS";
};

/** Administradora como vem do cadastro: dados gerais + as tabelas dela. */
export type AdministratorBaseLike = {
  id: string;
  graceMonths: number;
  cutoffDay: number | null;
  paysSellerDirectly: boolean;
  unpaidPolicy: UnpaidPolicy;
  tables: CommissionTableLike[];
};

/** A administradora JÁ com a tabela da categoria da venda aplicada — é o que o cálculo usa. */
export type AdministratorLike = Omit<AdministratorBaseLike, "tables"> & Omit<CommissionTableLike, "creditType">;

/**
 * Escolhe a tabela que vale pra uma venda: a da categoria dela (Imóvel,
 * Automóvel…, comparando sem diferença de maiúscula/espaço) ou, se não
 * existir, a padrão. Null só quando a administradora não tem tabela nenhuma.
 */
export function resolveAdministrator(base: AdministratorBaseLike, creditType: string | null): AdministratorLike | null {
  const norm = (v: string) => v.trim().toLocaleLowerCase("pt-BR");
  const byCategory = creditType ? base.tables.find((t) => t.creditType && norm(t.creditType) === norm(creditType)) : undefined;
  const table = byCategory ?? base.tables.find((t) => t.creditType === null) ?? null;
  if (!table) return null;
  const { tables: _tables, ...general } = base;
  void _tables;
  const { creditType: _ct, ...config } = table;
  void _ct;
  return { ...general, ...config };
}

export type SaleLike = {
  sellerId: string;
  supervisorId: string | null;
  managerId: string | null;
  administratorId: string | null;
  modality: Modality;
  creditType: string | null;
  saleDate: Date;
  netValue: number | null;
  grossValue: number | null;
  /** Parcela (mensalidade) que o cliente paga — só pra administradora em "% da parcela do cliente". */
  clientInstallment: number | null;
};

/** Uma parcela do que a CORRETORA recebe da administradora. */
export type RevenueInstallment = {
  installmentNumber: number;
  installmentCount: number;
  paymentMonth: string;
  amountCents: number;
  percent: number;
};

/** Por que não dá pra saber quanto a corretora recebe numa venda. */
export type RevenueProblem = "NO_CONFIG" | "NO_VALUE" | "NO_CLIENT_INSTALLMENT";

export type ScheduledInstallment = {
  role: BeneficiaryRole;
  beneficiaryId: string;
  installmentNumber: number;
  installmentCount: number;
  paymentMonth: string;
  amountCents: number;
  percent: number;
  ruleId: string;
  paidByAdministrator: boolean;
};

/** Por que uma venda (ou um papel dela) ficou sem parcela nenhuma — vira aviso pro Financeiro. */
export type ScheduleProblem =
  | { code: "NO_ADMINISTRATOR" }
  | { code: "NO_RULE"; role: BeneficiaryRole }
  | { code: "NO_VALUE"; role: BeneficiaryRole; base: "NET" | "GROSS" }
  // Regra "% do que a corretora recebe" sem dar pra calcular o que ela recebe.
  | { code: "NO_REVENUE"; role: BeneficiaryRole; reason: RevenueProblem };

export function beneficiaryFor(sale: SaleLike, role: BeneficiaryRole): string | null {
  if (role === "SELLER") return sale.sellerId;
  if (role === "SUPERVISOR") return sale.supervisorId;
  return sale.managerId;
}

/**
 * O que a CORRETORA recebe da administradora por uma venda, parcela a
 * parcela — nos três jeitos que uma administradora pode pagar:
 *  - CREDIT_EQUAL: X% do crédito no total, em partes iguais;
 *  - CREDIT_TABLE: um % do crédito por parcela (a tabela dela);
 *  - CLIENT_INSTALLMENT_TABLE: um % da parcela que o cliente paga, por parcela.
 * Mesmo calendário das parcelas de comissão (carência, dia de corte).
 */
/** 1 nas parcelas que pagam, 0 nas "sem comissão" (alinhado com o número de parcelas). */
export function installmentMask(administrator: Pick<AdministratorLike, "commissionInstallments" | "skippedInstallments">): number[] {
  const count = Math.max(1, administrator.commissionInstallments);
  const skipped = new Set(administrator.skippedInstallments ?? []);
  return Array.from({ length: count }, (_, i) => (skipped.has(i + 1) ? 0 : 1));
}

export function buildRevenueSchedule(
  sale: Pick<SaleLike, "saleDate" | "netValue" | "grossValue" | "clientInstallment">,
  administrator: AdministratorLike,
): { installments: RevenueInstallment[]; problem: RevenueProblem | null } {
  const mode = administrator.revenueMode;
  if (!mode) return { installments: [], problem: "NO_CONFIG" };
  const count = Math.max(1, administrator.commissionInstallments);
  const mask = installmentMask(administrator);
  const first = firstPaymentMonth(sale.saleDate, administrator.cutoffDay, administrator.graceMonths);

  let baseValue: number | null;
  if (mode === "CLIENT_INSTALLMENT_TABLE") {
    baseValue = sale.clientInstallment;
    if (baseValue == null || baseValue <= 0) return { installments: [], problem: "NO_CLIENT_INSTALLMENT" };
  } else {
    baseValue = administrator.revenueBase === "GROSS" ? sale.grossValue : sale.netValue;
    if (baseValue == null || baseValue <= 0) return { installments: [], problem: "NO_VALUE" };
  }
  const baseCents = Math.round(baseValue * 100);

  let amounts: number[];
  let percents: number[];
  if (mode === "CREDIT_EQUAL") {
    const total = administrator.revenueTotalPercent;
    if (total == null || total <= 0) return { installments: [], problem: "NO_CONFIG" };
    // O total se divide só entre as parcelas que pagam.
    const paying = mask.reduce((a, b) => a + b, 0) || 1;
    amounts = splitByWeights(Math.round((baseCents * total) / 100), mask);
    percents = mask.map((m) => (m ? total / paying : 0));
  } else {
    const table = administrator.revenuePercents;
    if (!table || table.length === 0) return { installments: [], problem: "NO_CONFIG" };
    percents = Array.from({ length: count }, (_, i) => (mask[i] && Number.isFinite(table[i]) ? Math.max(0, table[i]) : 0));
    amounts = percents.map((p) => Math.round((baseCents * p) / 100));
  }

  return {
    installments: amounts
      .map((amountCents, index) => ({
        installmentNumber: index + 1,
        installmentCount: count,
        paymentMonth: addMonths(first, index),
        amountCents,
        percent: percents[index],
      }))
      // Parcela sem comissão (ou 0% na tabela) não vira linha nenhuma.
      .filter((r) => r.amountCents > 0),
    problem: null,
  };
}

/**
 * Todas as parcelas de comissão que uma venda gera, de todo mundo que recebe
 * por ela, e o que a corretora recebe da administradora. Supervisor/gerente
 * só entram se existir regra pra eles (é opcional por corretora) e nunca
 * recebem "por cima" da própria venda — quem vendeu já recebe como vendedor;
 * ganhar de novo como líder da equipe na MESMA venda pagaria a mesma pessoa
 * duas vezes.
 *
 * A comissão de cada pessoa acompanha o RITMO em que a corretora recebe:
 * se a administradora paga mais na 1ª parcela, o consultor também recebe
 * mais na 1ª (sem administradora informada, partes iguais).
 */
export function buildSaleSchedule(
  sale: SaleLike,
  administrator: AdministratorLike | null,
  rules: RuleLike[],
): {
  installments: ScheduledInstallment[];
  problems: ScheduleProblem[];
  revenue: RevenueInstallment[];
  revenueProblem: RevenueProblem | null;
} {
  if (!administrator || !sale.administratorId) {
    return { installments: [], problems: [{ code: "NO_ADMINISTRATOR" }], revenue: [], revenueProblem: null };
  }

  const installments: ScheduledInstallment[] = [];
  const problems: ScheduleProblem[] = [];
  const count = Math.max(1, administrator.commissionInstallments);
  const first = firstPaymentMonth(sale.saleDate, administrator.cutoffDay, administrator.graceMonths);
  const { installments: revenue, problem: revenueProblem } = buildRevenueSchedule(sale, administrator);
  const revenueTotal = revenue.reduce((acc, r) => acc + r.amountCents, 0);
  // Peso de cada parcela = o que a corretora recebe nela; sem isso, iguais.
  // Parcela "sem comissão" pesa 0 nos dois casos.
  const mask = installmentMask(administrator);
  const revenueByNumber = new Map(revenue.map((r) => [r.installmentNumber, r.amountCents]));
  const weights = revenueTotal > 0 ? mask.map((m, i) => (m ? (revenueByNumber.get(i + 1) ?? 0) : 0)) : mask;

  for (const role of BENEFICIARY_ROLES) {
    const beneficiaryId = beneficiaryFor(sale, role);
    if (!beneficiaryId) continue;
    if (role !== "SELLER" && beneficiaryId === sale.sellerId) continue;

    const rule = pickRule(rules, {
      role,
      userId: beneficiaryId,
      administratorId: sale.administratorId,
      modality: sale.modality,
      creditType: sale.creditType,
    });
    if (!rule) {
      // Sem regra pro vendedor é problema (venda sem comissão nenhuma);
      // sem regra pra supervisor/gerente é só "essa corretora não paga" —
      // não vira aviso.
      if (role === "SELLER") problems.push({ code: "NO_RULE", role });
      continue;
    }

    let parts: number[];
    if (rule.base === "COMPANY_REVENUE") {
      if (revenueTotal <= 0) {
        problems.push({ code: "NO_REVENUE", role, reason: revenueProblem ?? "NO_CONFIG" });
        continue;
      }
      // X% do que a corretora recebe — distribuído na mesma proporção.
      parts = splitByWeights(Math.round((revenueTotal * rule.percent) / 100), weights);
    } else {
      const baseValue = rule.base === "GROSS" ? sale.grossValue : sale.netValue;
      if (baseValue == null || baseValue <= 0) {
        problems.push({ code: "NO_VALUE", role, base: rule.base });
        continue;
      }
      const baseCents = Math.round(baseValue * 100);
      parts = splitByWeights(Math.round((baseCents * rule.percent) / 100), weights);
    }
    parts.forEach((amountCents, index) => {
      // Parcela sem comissão (peso 0) não vira linha nenhuma — o consultor
      // não vê um "R$ 0,00" naquele mês, só o mês sem nada.
      if (amountCents <= 0) return;
      installments.push({
        role,
        beneficiaryId,
        installmentNumber: index + 1,
        installmentCount: count,
        paymentMonth: addMonths(first, index),
        amountCents,
        percent: rule.percent,
        ruleId: rule.id,
        // Só a parte do VENDEDOR: é ele que a administradora paga direto
        // (pedido original: "a Servopa paga diretamente eles"); comissão de
        // liderança continua saindo da corretora.
        paidByAdministrator: role === "SELLER" && administrator.paysSellerDirectly,
      });
    });
  }

  return { installments, problems, revenue, revenueProblem };
}

/** Lê uma lista de percentuais (Json do banco) num array de números, ou null. */
export function parsePercentList(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const nums = value.map((v) => Number(v));
  return nums.every((n) => Number.isFinite(n)) ? nums : null;
}

// ─── Textos curtos (telas) ───────────────────────────────────────────

const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MONTH_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "2026-10" → "Outubro de 2026" (ou "Outubro" com `withYear: false`). */
export function formatMonthLong(key: string, opts?: { withYear?: boolean }): string {
  const [y, m] = key.split("-").map(Number);
  const name = MONTH_NAMES[m - 1] ?? key;
  const cap = name.charAt(0).toUpperCase() + name.slice(1);
  return opts?.withYear === false ? cap : `${cap} de ${y}`;
}

/** "2026-10" → "out/26". */
export function formatMonthShort(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTH_SHORT[m - 1] ?? "?"}/${String(y).slice(2)}`;
}

export const ROLE_LABELS: Record<BeneficiaryRole, string> = {
  SELLER: "Vendedor",
  SUPERVISOR: "Supervisor",
  MANAGER: "Gerente",
};

export const MODALITY_LABELS: Record<Modality, string> = {
  FULL: "Parcela cheia",
  REDUCED: "Meia parcela",
};

export function problemLabel(problem: ScheduleProblem): string {
  if (problem.code === "NO_ADMINISTRATOR") return "Sem administradora";
  if (problem.code === "NO_RULE") return "Sem regra";
  if (problem.code === "NO_REVENUE") return revenueProblemLabel(problem.reason);
  return problem.base === "GROSS" ? "Sem valor bruto" : "Sem valor líquido";
}

export function revenueProblemLabel(reason: RevenueProblem): string {
  if (reason === "NO_CLIENT_INSTALLMENT") return "Sem parcela do cliente";
  if (reason === "NO_VALUE") return "Sem valor da venda";
  return "Sem % da administradora";
}

/** "1.25" → "1,25%". */
export function formatPercent(value: number): string {
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 4 })}%`;
}
