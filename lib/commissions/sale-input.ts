/**
 * Campos de uma venda de comissão que o Financeiro pode lançar/corrigir —
 * compartilhado entre "Venda fora do CRM" (POST) e editar venda (PATCH).
 */

import { prisma } from "@/lib/prisma";
import { brazilDateKey, brazilDateStringWithNowTimeToUTC } from "@/lib/timezone";
import { optionalText, parseMoney } from "@/lib/commissions/route-helpers";

export type SaleInput = {
  clientName?: string;
  sellerId?: string;
  administratorId?: string | null;
  modality?: "FULL" | "REDUCED";
  creditType?: string | null;
  saleDate?: Date;
  netValue?: number | null;
  grossValue?: number | null;
  clientInstallment?: number | null;
  quotaNumber?: string | null;
  groupNumber?: string | null;
  notes?: string | null;
};

type Result = { ok: true; data: SaleInput } | { ok: false; error: string };

function moneyOrNull(value: unknown): number | null | undefined | "invalid" {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n = parseMoney(value);
  if (n == null || n < 0) return "invalid";
  return n;
}

export function parseSaleInput(body: Record<string, unknown>, opts: { partial: boolean }): Result {
  const data: SaleInput = {};

  if (body.clientName !== undefined || !opts.partial) {
    const name = typeof body.clientName === "string" ? body.clientName.trim().slice(0, 120) : "";
    if (!name) return { ok: false, error: "Informe o nome do cliente" };
    data.clientName = name;
  }
  if (body.sellerId !== undefined || !opts.partial) {
    if (typeof body.sellerId !== "string" || !body.sellerId) return { ok: false, error: "Escolha o vendedor" };
    data.sellerId = body.sellerId;
  }
  if (body.administratorId !== undefined) {
    if (body.administratorId !== null && body.administratorId !== "" && typeof body.administratorId !== "string") {
      return { ok: false, error: "Administradora inválida" };
    }
    data.administratorId = body.administratorId ? (body.administratorId as string) : null;
  }
  if (body.modality !== undefined) {
    if (body.modality !== "FULL" && body.modality !== "REDUCED") return { ok: false, error: "Modalidade inválida" };
    data.modality = body.modality;
  }
  if (body.creditType !== undefined) data.creditType = optionalText(body.creditType, 80) ?? null;
  if (body.saleDate !== undefined || !opts.partial) {
    if (typeof body.saleDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.saleDate)) return { ok: false, error: "Data da venda inválida" };
    if (body.saleDate > brazilDateKey()) return { ok: false, error: "A data da venda não pode ser no futuro" };
    data.saleDate = brazilDateStringWithNowTimeToUTC(body.saleDate);
    if (isNaN(data.saleDate.getTime())) return { ok: false, error: "Data da venda inválida" };
  }
  for (const key of ["netValue", "grossValue", "clientInstallment"] as const) {
    const v = moneyOrNull(body[key]);
    if (v === "invalid") {
      return { ok: false, error: key === "netValue" ? "Valor líquido inválido" : key === "grossValue" ? "Valor bruto inválido" : "Valor da parcela do cliente inválido" };
    }
    if (v !== undefined) data[key] = v;
  }
  for (const key of ["quotaNumber", "groupNumber"] as const) {
    if (body[key] !== undefined) data[key] = optionalText(body[key], 40) ?? null;
  }
  if (body.notes !== undefined) data.notes = optionalText(body.notes, 1000) ?? null;

  return { ok: true, data };
}

/** Confere que vendedor e administradora são desta organização; devolve a equipe do vendedor (líder/gerente) pra fotografar. */
export async function resolveSaleReferences(organizationId: string, data: SaleInput) {
  let team: { leaderId: string | null; managerId: string | null } | null | undefined;
  if (data.sellerId) {
    const member = await prisma.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId, userId: data.sellerId } },
      select: { team: { select: { leaderId: true, managerId: true } } },
    });
    if (!member) return { error: "Vendedor inválido" as const };
    team = member.team;
  }
  if (data.administratorId) {
    const administrator = await prisma.consortiumAdministrator.findFirst({
      where: { id: data.administratorId, organizationId },
      select: { id: true },
    });
    if (!administrator) return { error: "Administradora inválida" as const };
  }
  return { team };
}
