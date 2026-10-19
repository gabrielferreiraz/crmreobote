/**
 * Validação dos cadastros do módulo de Comissões — compartilhada entre
 * criar (POST) e editar (PATCH), pra a mesma regra nunca divergir entre os
 * dois. Devolve os dados limpos ou a mensagem de erro (curta, de tela).
 */

import { Prisma } from "@/app/generated/prisma/client";
import { revenueConfigError, type RevenueMode, type UnpaidPolicy } from "@/lib/commissions/engine";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** Uma tabela de comissão (padrão ou de uma categoria), já validada. */
export type CommissionTableInput = {
  creditType: string | null;
  commissionInstallments: number;
  skippedInstallments: number[];
  revenueMode: RevenueMode | null;
  revenueTotalPercent: number | null;
  revenuePercents: number[] | null;
  revenueBase: "NET" | "GROSS";
};

export type AdministratorInput = {
  name?: string;
  active?: boolean;
  graceMonths?: number;
  cutoffDay?: number | null;
  paysSellerDirectly?: boolean;
  unpaidPolicy?: UnpaidPolicy;
  /** Quando vem, SUBSTITUI todas as tabelas da administradora (sempre com uma padrão). */
  tables?: CommissionTableInput[];
};

const REVENUE_MODES: RevenueMode[] = ["CREDIT_EQUAL", "CREDIT_TABLE", "CLIENT_INSTALLMENT_TABLE"];
const UNPAID_POLICIES: UnpaidPolicy[] = ["IGNORE", "HOLD", "FORFEIT", "DEFER"];

function percentOrNull(value: unknown): number | null | "invalid" {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "string" ? Number(value.replace(",", ".")) : value;
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n * 10000) / 10000 : "invalid";
}

function intInRange(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** Valida UMA tabela; `label` entra na mensagem ("Na tabela de Imóvel: …"). */
function parseTable(raw: unknown): Result<CommissionTableInput> {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Tabela inválida" };
  const t = raw as Record<string, unknown>;
  const creditType = typeof t.creditType === "string" && t.creditType.trim() ? t.creditType.trim().slice(0, 80) : null;
  const where = creditType ? `Na tabela de ${creditType}: ` : "";

  const count = intInRange(t.commissionInstallments ?? 1, 1, 60);
  if (count == null) return { ok: false, error: `${where}o número de parcelas deve ser de 1 a 60` };

  const skippedRaw = Array.isArray(t.skippedInstallments) ? t.skippedInstallments : [];
  const skipped = Array.from(new Set(skippedRaw.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 1 && n <= count))).sort((a, b) => a - b);
  if (skipped.length >= count) return { ok: false, error: `${where}pelo menos uma parcela precisa ter comissão` };

  const mode = t.revenueMode ?? null;
  if (mode !== null && !REVENUE_MODES.includes(mode as RevenueMode)) return { ok: false, error: `${where}opção inválida em quanto a administradora paga` };

  const total = percentOrNull(t.revenueTotalPercent);
  if (total === "invalid") return { ok: false, error: `${where}percentual inválido` };
  let percents: number[] | null = null;
  if (Array.isArray(t.revenuePercents)) {
    const list = t.revenuePercents.map((v) => percentOrNull(v));
    if (list.some((v) => v === "invalid")) return { ok: false, error: `${where}algum percentual está inválido` };
    percents = Array.from({ length: count }, (_, i) => {
      const v = list[i];
      // Parcela sem comissão nunca guarda %: fica 0.
      return skipped.includes(i + 1) || v === null || v === "invalid" || v === undefined ? 0 : v;
    });
  }

  const base = t.revenueBase ?? "NET";
  if (base !== "NET" && base !== "GROSS") return { ok: false, error: `${where}opção inválida` };

  const revenueMode = mode as RevenueMode | null;
  const error = revenueConfigError(revenueMode, count, revenueMode === "CREDIT_EQUAL" ? total : null, revenueMode === "CREDIT_EQUAL" ? null : percents);
  if (error) return { ok: false, error: `${where}${error.charAt(0).toLowerCase()}${error.slice(1)}` };

  return {
    ok: true,
    data: {
      creditType,
      commissionInstallments: count,
      skippedInstallments: skipped,
      revenueMode,
      // Guarda só o que o modo usa — trocar de modo nunca deixa sobra do anterior.
      revenueTotalPercent: revenueMode === "CREDIT_EQUAL" ? total : null,
      revenuePercents: revenueMode === "CREDIT_TABLE" || revenueMode === "CLIENT_INSTALLMENT_TABLE" ? percents : null,
      revenueBase: base,
    },
  };
}

/**
 * Cadastro de administradora. `partial: true` (PATCH) aceita só os campos
 * enviados; `tables`, quando vem, é a lista COMPLETA (substitui as atuais) e
 * precisa ter exatamente uma padrão (sem categoria) e nenhuma categoria
 * repetida.
 */
export function parseAdministratorInput(body: Record<string, unknown>, opts: { partial: boolean }): Result<AdministratorInput> {
  const data: AdministratorInput = {};

  if (body.name !== undefined || !opts.partial) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return { ok: false, error: "Informe o nome da administradora" };
    if (name.length > 80) return { ok: false, error: "Nome muito longo" };
    data.name = name;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") return { ok: false, error: "Opção inválida" };
    data.active = body.active;
  }
  if (body.graceMonths !== undefined || !opts.partial) {
    const n = intInRange(body.graceMonths ?? 1, 0, 24);
    if (n == null) return { ok: false, error: "Carência deve ser de 0 a 24 meses" };
    data.graceMonths = n;
  }
  if (body.cutoffDay !== undefined) {
    if (body.cutoffDay === null || body.cutoffDay === "") {
      data.cutoffDay = null;
    } else {
      const n = intInRange(body.cutoffDay, 1, 31);
      if (n == null) return { ok: false, error: "Dia de corte deve ser de 1 a 31" };
      data.cutoffDay = n;
    }
  }
  if (body.paysSellerDirectly !== undefined) {
    if (typeof body.paysSellerDirectly !== "boolean") return { ok: false, error: "Opção inválida" };
    data.paysSellerDirectly = body.paysSellerDirectly;
  }
  if (body.unpaidPolicy !== undefined) {
    if (!UNPAID_POLICIES.includes(body.unpaidPolicy as UnpaidPolicy)) return { ok: false, error: "Opção inválida para cliente que não pagou" };
    // "Trava até pagar" saiu das opções: quem ainda mandar HOLD vira "recebe quando o cliente pagar".
    data.unpaidPolicy = body.unpaidPolicy === "HOLD" ? "DEFER" : (body.unpaidPolicy as UnpaidPolicy);
  }
  if (body.tables !== undefined || !opts.partial) {
    if (!Array.isArray(body.tables) || body.tables.length === 0) return { ok: false, error: "Informe como a administradora paga" };
    const tables: CommissionTableInput[] = [];
    for (const raw of body.tables) {
      const parsed = parseTable(raw);
      if (!parsed.ok) return parsed;
      tables.push(parsed.data);
    }
    if (tables.filter((t) => t.creditType === null).length !== 1) return { ok: false, error: "Precisa existir exatamente uma tabela padrão" };
    const categories = tables.filter((t) => t.creditType).map((t) => t.creditType!.toLocaleLowerCase("pt-BR"));
    if (new Set(categories).size !== categories.length) return { ok: false, error: "Uma categoria aparece em duas tabelas" };
    data.tables = tables;
  }

  return { ok: true, data };
}

/** Tabela validada → linha do Prisma (lista nula vira DbNull; % vira string de Decimal). */
export function tablePrismaData(organizationId: string, table: CommissionTableInput) {
  return {
    organizationId,
    creditType: table.creditType,
    commissionInstallments: table.commissionInstallments,
    skippedInstallments: table.skippedInstallments,
    revenueMode: table.revenueMode,
    revenueTotalPercent: table.revenueTotalPercent == null ? null : table.revenueTotalPercent.toFixed(4),
    revenuePercents: table.revenuePercents ?? Prisma.DbNull,
    revenueBase: table.revenueBase,
  };
}

export type RuleInput = {
  beneficiaryRole?: "SELLER" | "SUPERVISOR" | "MANAGER";
  userId?: string | null;
  administratorId?: string | null;
  modality?: "FULL" | "REDUCED" | null;
  creditType?: string | null;
  base?: "NET" | "GROSS" | "COMPANY_REVENUE";
  percent?: number;
  active?: boolean;
};

export function parseRuleInput(body: Record<string, unknown>, opts: { partial: boolean }): Result<RuleInput> {
  const data: RuleInput = {};
  const nullableId = (v: unknown) => (v === null || v === "" ? null : typeof v === "string" ? v : undefined);

  if (body.beneficiaryRole !== undefined || !opts.partial) {
    const role = body.beneficiaryRole ?? "SELLER";
    if (role !== "SELLER" && role !== "SUPERVISOR" && role !== "MANAGER") return { ok: false, error: "Quem recebe: opção inválida" };
    data.beneficiaryRole = role;
  }
  for (const key of ["userId", "administratorId"] as const) {
    if (body[key] !== undefined) {
      const v = nullableId(body[key]);
      if (v === undefined) return { ok: false, error: "Opção inválida" };
      data[key] = v;
    }
  }
  if (body.modality !== undefined) {
    const m = body.modality === "" ? null : body.modality;
    if (m !== null && m !== "FULL" && m !== "REDUCED") return { ok: false, error: "Modalidade inválida" };
    data.modality = m;
  }
  if (body.creditType !== undefined) {
    if (body.creditType !== null && typeof body.creditType !== "string") return { ok: false, error: "Tipo de crédito inválido" };
    data.creditType = typeof body.creditType === "string" && body.creditType.trim() ? body.creditType.trim().slice(0, 80) : null;
  }
  if (body.base !== undefined || !opts.partial) {
    const base = body.base ?? "NET";
    if (base !== "NET" && base !== "GROSS" && base !== "COMPANY_REVENUE") return { ok: false, error: "Base de cálculo inválida" };
    data.base = base;
  }
  if (body.percent !== undefined || !opts.partial) {
    const raw = typeof body.percent === "string" ? Number(body.percent.replace(",", ".")) : body.percent;
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0 || raw > 100) {
      return { ok: false, error: "Percentual deve ser maior que 0 e até 100" };
    }
    data.percent = Math.round(raw * 10000) / 10000;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") return { ok: false, error: "Opção inválida" };
    data.active = body.active;
  }
  return { ok: true, data };
}
