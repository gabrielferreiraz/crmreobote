/**
 * Validação dos cadastros do módulo de Comissões — compartilhada entre
 * criar (POST) e editar (PATCH), pra a mesma regra nunca divergir entre os
 * dois. Devolve os dados limpos ou a mensagem de erro (curta, de tela).
 */

import { Prisma } from "@/app/generated/prisma/client";
import { parsePercentList, revenueConfigError, type RevenueMode } from "@/lib/commissions/engine";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export type AdministratorInput = {
  name?: string;
  active?: boolean;
  commissionInstallments?: number;
  graceMonths?: number;
  cutoffDay?: number | null;
  paysSellerDirectly?: boolean;
  revenueMode?: RevenueMode | null;
  revenueTotalPercent?: number | null;
  revenuePercents?: number[] | null;
  revenueBase?: "NET" | "GROSS";
};

type ExistingRevenue = {
  commissionInstallments: number;
  revenueMode: RevenueMode | null;
  revenueTotalPercent: number | null;
  revenuePercents: number[] | null;
};

const REVENUE_MODES: RevenueMode[] = ["CREDIT_EQUAL", "CREDIT_TABLE", "CLIENT_INSTALLMENT_TABLE"];

function percentOrNull(value: unknown): number | null | "invalid" {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "string" ? Number(value.replace(",", ".")) : value;
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n * 10000) / 10000 : "invalid";
}

function intInRange(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/**
 * `partial: true` (PATCH) aceita só os campos enviados; `existing` completa
 * o que faltar pra validar o CONJUNTO (ex.: mudar só o número de parcelas
 * precisa conferir a tabela de percentuais que já estava salva).
 */
export function parseAdministratorInput(
  body: Record<string, unknown>,
  opts: { partial: boolean; existing?: ExistingRevenue },
): Result<AdministratorInput> {
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
  if (body.commissionInstallments !== undefined || !opts.partial) {
    const n = intInRange(body.commissionInstallments ?? 1, 1, 60);
    if (n == null) return { ok: false, error: "Número de parcelas deve ser de 1 a 60" };
    data.commissionInstallments = n;
  }
  if (body.revenueMode !== undefined) {
    if (body.revenueMode !== null && !REVENUE_MODES.includes(body.revenueMode as RevenueMode)) {
      return { ok: false, error: "Opção inválida em quanto a administradora paga" };
    }
    data.revenueMode = (body.revenueMode as RevenueMode | null) ?? null;
  }
  if (body.revenueTotalPercent !== undefined) {
    const n = percentOrNull(body.revenueTotalPercent);
    if (n === "invalid") return { ok: false, error: "Percentual inválido" };
    data.revenueTotalPercent = n;
  }
  if (body.revenuePercents !== undefined) {
    if (body.revenuePercents === null) {
      data.revenuePercents = null;
    } else if (Array.isArray(body.revenuePercents)) {
      const list = body.revenuePercents.map((v) => percentOrNull(v));
      if (list.some((v) => v === "invalid")) return { ok: false, error: "Algum percentual está inválido" };
      data.revenuePercents = list.map((v) => (v === null || v === "invalid" ? 0 : v));
    } else {
      return { ok: false, error: "Percentuais inválidos" };
    }
  }
  if (body.revenueBase !== undefined) {
    if (body.revenueBase !== "NET" && body.revenueBase !== "GROSS") return { ok: false, error: "Opção inválida" };
    data.revenueBase = body.revenueBase;
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

  // "Quanto paga pra corretora" sempre conferido como CONJUNTO final (o
  // que veio no corpo, completado pelo que já estava salvo).
  const pick = <K extends keyof ExistingRevenue>(key: K): ExistingRevenue[K] | null =>
    (data as Partial<ExistingRevenue>)[key] !== undefined ? ((data as ExistingRevenue)[key]) : (opts.existing?.[key] ?? null);
  const finalCount = pick("commissionInstallments") ?? 1;
  const finalMode = pick("revenueMode");
  const finalTotal = pick("revenueTotalPercent");
  const finalPercents = pick("revenuePercents");
  const revenueError = revenueConfigError(finalMode, finalCount, finalTotal, finalPercents);
  if (revenueError) return { ok: false, error: revenueError };
  // Guarda só o que o modo usa — trocar de modo nunca deixa sobra do anterior.
  if (data.revenueMode !== undefined) {
    if (finalMode !== "CREDIT_EQUAL") data.revenueTotalPercent = null;
    if (finalMode !== "CREDIT_TABLE" && finalMode !== "CLIENT_INSTALLMENT_TABLE") data.revenuePercents = null;
  }

  return { ok: true, data };
}

/** AdministratorInput → `data` do Prisma (lista nula vira DbNull; % vira string de Decimal). */
export function administratorPrismaData(input: AdministratorInput) {
  const { revenuePercents, revenueTotalPercent, ...rest } = input;
  return {
    ...rest,
    ...(revenuePercents !== undefined ? { revenuePercents: revenuePercents ?? Prisma.DbNull } : {}),
    ...(revenueTotalPercent !== undefined ? { revenueTotalPercent: revenueTotalPercent == null ? null : revenueTotalPercent.toFixed(4) } : {}),
  };
}

/** Linha do banco → o que a validação precisa saber do que já está salvo. */
export function existingRevenueFrom(row: {
  commissionInstallments: number;
  revenueMode: RevenueMode | null;
  revenueTotalPercent: { toString(): string } | null;
  revenuePercents: unknown;
}): ExistingRevenue {
  return {
    commissionInstallments: row.commissionInstallments,
    revenueMode: row.revenueMode,
    revenueTotalPercent: row.revenueTotalPercent != null ? Number(row.revenueTotalPercent) : null,
    revenuePercents: parsePercentList(row.revenuePercents),
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
