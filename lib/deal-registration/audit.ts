/**
 * Auditoria do cadastro do cliente e da cota: quais campos entram, como cada um
 * aparece (rótulo, formato, máscara) e a leitura do "antes/depois" no banco.
 * Sempre chamado dentro de runWithTenant e filtrando por organizationId.
 */

import { prisma } from "@/lib/prisma";
import { diffFields, type AuditChange, type FieldSpec } from "@/lib/audit-diff";
import { formatCurrency } from "@/lib/format";
import { describeExtraQuotas, parseExtraQuotas } from "./extra-quotas";

const money = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? formatCurrency(n) : null;
};

/** Da cota vendida: o consultor preenche no cadastro do Ganho. */
const CONSULTANT_QUOTA_FIELD_SPECS: Record<string, FieldSpec> = {
  groupNumber: { label: "Grupo" },
  creditValue: { label: "Valor do crédito", format: money },
  termMonths: { label: "Prazo", format: (v) => (v === null || v === undefined || v === "" ? null : `${v} meses`) },
  paymentMethod: { label: "Forma de pagamento" },
};

/**
 * Cotas extras entram na auditoria como UMA linha de texto já pronta (ver
 * describeExtraQuotas), não campo a campo: o que importa registrar é que a
 * venda passou a ter outras cotas e quais são. Fica fora de
 * QUOTA_FIELD_SPECS porque o administrativo não mexe nisso.
 */
const EXTRA_QUOTAS_FIELD_SPEC: Record<string, FieldSpec> = {
  extraQuotas: { label: "Cotas extras" },
};

/** Dados do cliente e do cadastro que o consultor edita (inclui grupo, prazo e forma de pagamento). */
export const REGISTRATION_FIELD_SPECS: Record<string, FieldSpec> = {
  ...CONSULTANT_QUOTA_FIELD_SPECS,
  ...EXTRA_QUOTAS_FIELD_SPEC,
  holderName: { label: "Nome do titular na administradora" },
  personType: { label: "Tipo de cliente", format: (v) => (v === "PJ" ? "Pessoa jurídica" : v === "PF" ? "Pessoa física" : null) },
  cpf: { label: "CPF", sensitive: true },
  cnpj: { label: "CNPJ" },
  company: { label: "Empresa" },
  email: { label: "E-mail" },
  whatsapp: { label: "Celular" },
  zipCode: { label: "CEP" },
  address: { label: "Rua" },
  addressNumber: { label: "Número" },
  addressComplement: { label: "Complemento" },
  neighborhood: { label: "Bairro" },
  city: { label: "Cidade" },
  state: { label: "UF" },
  profession: { label: "Profissão" },
  maritalStatus: { label: "Estado civil" },
  monthlyIncome: { label: "Renda mensal", format: money },
  bankName: { label: "Banco" },
  bankAgency: { label: "Agência", sensitive: true },
  bankAccount: { label: "Conta", sensitive: true },
  bankAccountType: { label: "Tipo de conta" },
};

/** O que o administrativo salva na cota: cota e dígito (e, só se o consultor deixou em branco, os demais). */
export const QUOTA_FIELD_SPECS: Record<string, FieldSpec> = {
  quotaNumber: { label: "Cota" },
  quotaDigit: { label: "Dígito" },
  ...CONSULTANT_QUOTA_FIELD_SPECS,
};

/** Valores de hoje (cliente + cadastro), com os mesmos nomes dos specs acima. */
export async function loadRegistrationAuditSnapshot(organizationId: string, dealId: string): Promise<Record<string, unknown>> {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, organizationId },
    select: {
      contact: {
        select: {
          email: true,
          whatsapp: true,
          zipCode: true,
          address: true,
          addressNumber: true,
          addressComplement: true,
          neighborhood: true,
          city: true,
          state: true,
          company: true,
        },
      },
      registration: {
        select: {
          personType: true,
          holderName: true,
          cpf: true,
          cnpj: true,
          profession: true,
          maritalStatus: true,
          monthlyIncome: true,
          bankName: true,
          bankAgency: true,
          bankAccount: true,
          bankAccountType: true,
          groupNumber: true,
          creditValue: true,
          quotaNumber: true,
          quotaDigit: true,
          termMonths: true,
          paymentMethod: true,
          extraQuotas: true,
        },
      },
    },
  });
  const r = deal?.registration;
  return {
    ...(deal?.contact ?? {}),
    personType: r?.personType ?? "PF",
    holderName: r?.holderName ?? null,
    cpf: r?.cpf ?? null,
    cnpj: r?.cnpj ?? null,
    profession: r?.profession ?? null,
    maritalStatus: r?.maritalStatus ?? null,
    monthlyIncome: r?.monthlyIncome != null ? Number(r.monthlyIncome) : null,
    bankName: r?.bankName ?? null,
    bankAgency: r?.bankAgency ?? null,
    bankAccount: r?.bankAccount ?? null,
    bankAccountType: r?.bankAccountType ?? null,
    groupNumber: r?.groupNumber ?? null,
    creditValue: r?.creditValue != null ? Number(r.creditValue) : null,
    quotaNumber: r?.quotaNumber ?? null,
    quotaDigit: r?.quotaDigit ?? null,
    termMonths: r?.termMonths ?? null,
    paymentMethod: r?.paymentMethod ?? null,
    extraQuotas: describeExtraQuotas(parseExtraQuotas(r?.extraQuotas)),
  };
}

export function diffRegistrationSnapshots(before: Record<string, unknown>, after: Record<string, unknown>): AuditChange[] {
  return diffFields(before, after, REGISTRATION_FIELD_SPECS);
}

export function diffQuotaSnapshots(before: Record<string, unknown>, after: Record<string, unknown>): AuditChange[] {
  return diffFields(before, after, QUOTA_FIELD_SPECS);
}

/** Nome do cliente da venda: é o "item" que a tela de auditoria mostra no lugar do código. */
export async function getDealAuditLabel(organizationId: string, dealId: string): Promise<string | null> {
  const deal = await prisma.deal.findFirst({ where: { id: dealId, organizationId }, select: { contact: { select: { name: true } } } });
  return deal?.contact.name ?? null;
}
