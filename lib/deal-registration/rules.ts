/**
 * Cadastro do cliente exigido pela administradora antes do Ganho.
 *
 * Regras (informadas pelo administrativo, 14/08): todas as administradoras
 * pedem documento com foto (CNH ou RG), CPF, endereço completo com CEP,
 * e-mail, celular, renda, profissão, estado civil e — para o cadastro da
 * cota — valor do crédito. Grupo, prazo e forma de pagamento são do
 * consultor; cota e dígito, do administrativo. Pessoa jurídica soma o CNPJ (sem contrato social). A Pontual pede, além disso, dados bancários
 * (ConsortiumAdministrator.requiresBankData).
 *
 * Módulo PURO (sem banco): a API valida com ele de verdade e a tela mostra a
 * mesma lista de pendências — uma regra só, nos dois lados.
 */

import { isValidCpf, normalizeCpf } from "@/lib/cpf";
import { isValidCnpj, normalizeCnpj } from "@/lib/cnpj";

export const MARITAL_STATUS_OPTIONS = [
  "Solteiro(a)",
  "Casado(a)",
  "União estável",
  "Divorciado(a)",
  "Separado(a)",
  "Viúvo(a)",
] as const;

export const PAYMENT_METHOD_OPTIONS = ["Boleto", "Débito em conta", "Cartão de crédito", "PIX"] as const;

export const BANK_ACCOUNT_TYPE_OPTIONS = ["Corrente", "Poupança"] as const;

export type RegistrationSnapshot = {
  contact: {
    email: string | null;
    whatsapp: string | null;
    phone: string | null;
    zipCode: string | null;
    address: string | null;
    addressNumber: string | null;
    neighborhood: string | null;
    city: string | null;
    state: string | null;
    /** Razão social / nome da empresa (pessoa jurídica) — vem da consulta do CNPJ. */
    company?: string | null;
  };
  registration: {
    personType: "PF" | "PJ";
    cpf: string | null;
    cnpj: string | null;
    profession: string | null;
    maritalStatus: string | null;
    monthlyIncome: number | null;
    groupNumber: string | null;
    /** Cota e dígito: opcionais no tipo para não quebrar quem monta o snapshot só com o cadastro do consultor. */
    quotaNumber?: string | null;
    quotaDigit?: string | null;
    termMonths: number | null;
    paymentMethod: string | null;
    bankName: string | null;
    bankAgency: string | null;
    bankAccount: string | null;
    bankAccountType: string | null;
  };
  documents: { kind: "PHOTO_ID" | "SOCIAL_CONTRACT" | "OTHER" }[];
};

export type RegistrationOptions = {
  /** A administradora escolhida pede dados bancários. */
  requiresBankData: boolean;
  /** O cliente já tem negócio ganho: a administradora já tem os documentos dele. */
  documentsWaived: boolean;
};

export type MissingItem = {
  key: string;
  /** Texto curto, pronto para a lista "Falta: …". */
  label: string;
  group: "contact" | "registration" | "bank" | "documents";
};

const blank = (v: string | null | undefined) => !v || !v.trim();

/** Itens que ainda faltam; lista vazia = pronto para o Ganho. */
export function findMissingRegistrationItems(snapshot: RegistrationSnapshot, options: RegistrationOptions): MissingItem[] {
  const { contact: c, registration: r, documents } = snapshot;
  const missing: MissingItem[] = [];
  const add = (key: string, label: string, group: MissingItem["group"]) => missing.push({ key, label, group });

  if (r.personType === "PJ") {
    if (blank(r.cnpj)) add("cnpj", "CNPJ", "registration");
    else if (!isValidCnpj(r.cnpj ?? "")) add("cnpj", "CNPJ válido", "registration");
  }
  if (blank(r.cpf)) add("cpf", r.personType === "PJ" ? "CPF do sócio" : "CPF", "registration");
  else if (!isValidCpf(r.cpf ?? "")) add("cpf", "CPF válido", "registration");

  if (blank(c.email)) add("email", "E-mail", "contact");
  // Celular = o número que recebe WhatsApp (fixo não conta): é por ele que a administradora fala com o cliente.
  if (blank(c.whatsapp)) add("whatsapp", "Celular", "contact");

  if (blank(c.zipCode)) add("zipCode", "CEP", "contact");
  if (blank(c.address)) add("address", "Rua", "contact");
  if (blank(c.addressNumber)) add("addressNumber", "Número", "contact");
  if (blank(c.neighborhood)) add("neighborhood", "Bairro", "contact");
  if (blank(c.city)) add("city", "Cidade", "contact");
  if (blank(c.state)) add("state", "Estado", "contact");

  if (r.monthlyIncome == null || !(r.monthlyIncome > 0)) add("monthlyIncome", "Renda mensal", "registration");
  if (blank(r.profession)) add("profession", "Profissão", "registration");
  if (blank(r.maritalStatus)) add("maritalStatus", "Estado civil", "registration");
  // Grupo, prazo e forma de pagamento são do CONSULTOR (ele vendeu aquela cota). Cota e dígito são do administrativo,
  // que os recebe da administradora ao cadastrar — por isso não entram aqui (decisão do administrativo, 10/11).
  if (blank(r.groupNumber)) add("groupNumber", "Grupo", "registration");
  if (r.termMonths == null || !(r.termMonths > 0)) add("termMonths", "Prazo", "registration");
  if (blank(r.paymentMethod)) add("paymentMethod", "Forma de pagamento", "registration");

  if (options.requiresBankData) {
    if (blank(r.bankName)) add("bankName", "Banco", "bank");
    if (blank(r.bankAgency)) add("bankAgency", "Agência", "bank");
    if (blank(r.bankAccount)) add("bankAccount", "Conta", "bank");
    if (blank(r.bankAccountType)) add("bankAccountType", "Tipo de conta", "bank");
  }

  if (!options.documentsWaived) {
    if (!documents.some((d) => d.kind === "PHOTO_ID")) add("doc:PHOTO_ID", "Documento com foto (CNH ou RG)", "documents");
    // Pessoa jurídica: o contrato social NÃO é exigido (decisão do dono, 09/11) — basta o documento com foto do sócio.
  }

  return missing;
}

/** "Falta: CPF, renda mensal e 2 mais" — frase curta para o aviso do botão. */
export function summarizeMissing(missing: MissingItem[], maxLabels = 3): string {
  if (missing.length === 0) return "";
  const shown = missing.slice(0, maxLabels).map((m) => m.label);
  const rest = missing.length - shown.length;
  return `Falta: ${shown.join(", ")}${rest > 0 ? ` e mais ${rest}` : ""}`;
}

export function normalizeRegistrationCpf(raw: string | null | undefined): string | null {
  const digits = normalizeCpf(raw ?? "");
  return digits ? digits : null;
}

export function normalizeRegistrationCnpj(raw: string | null | undefined): string | null {
  const digits = normalizeCnpj(raw ?? "");
  return digits ? digits : null;
}

/**
 * Quem pode marcar Ganho SEM o cadastro (com motivo registrado). Desligado para
 * todos a pedido do dono (08/11) — ele também precisa preencher, inclusive para
 * testar o fluxo. Para reabrir a exceção, devolva canBypassRegistration(m).
 */
export function canWaiveRegistration(m: { role: string; area: string }): boolean {
  void m;
  return false;
}

/** Quem enxerga documentos e dados sensíveis e marca a cota como cadastrada (Dono e Administrativo). */
export function canBypassRegistration(m: { role: string; area: string }): boolean {
  return m.role === "OWNER" || m.area === "ADMINISTRATIVO";
}

export const DOCUMENT_KIND_LABELS: Record<"PHOTO_ID" | "SOCIAL_CONTRACT" | "OTHER", string> = {
  PHOTO_ID: "Documento com foto (CNH ou RG)",
  SOCIAL_CONTRACT: "Contrato social",
  OTHER: "Outro documento",
};

/** Os documentos pessoais ficam no servidor só o tempo de o administrativo baixá-los. */
export const DOCUMENT_RETENTION_DAYS = 7;
/** Rascunho que nunca virou Ganho: apaga depois deste prazo (o consultor tem tempo de juntar tudo). */
export const DRAFT_DOCUMENT_RETENTION_DAYS = 30;

export const REGISTRATION_DOC_MAX_SIZE = 10 * 1024 * 1024;
export const REGISTRATION_DOC_MAX_FILES = 12;
export const REGISTRATION_DOC_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/** Cota: só números, até 6 dígitos. Dígito: só números, até 2. */
export const QUOTA_NUMBER_RE = /^\d{1,6}$/;
export const QUOTA_DIGIT_RE = /^\d{1,2}$/;

/** "Grupo 1568 · Cota 0123-00" — vazio se nada foi preenchido. */
export function formatQuotaLabel(q: { groupNumber?: string | null; quotaNumber?: string | null; quotaDigit?: string | null }): string {
  const parts: string[] = [];
  if (q.groupNumber?.trim()) parts.push(`Grupo ${q.groupNumber.trim()}`);
  if (q.quotaNumber?.trim()) parts.push(`Cota ${q.quotaNumber.trim()}${q.quotaDigit?.trim() ? `-${q.quotaDigit.trim()}` : ""}`);
  return parts.join(" · ");
}

/** Cota como o Processo a guarda: "0123-00" (ou só "0123" sem dígito). */
export function quotaWithDigit(quotaNumber: string | null | undefined, quotaDigit: string | null | undefined): string | null {
  const n = quotaNumber?.trim();
  if (!n) return null;
  const d = quotaDigit?.trim();
  return d ? `${n}-${d}` : n;
}

type QuotaFields = { groupNumber: string | null; quotaNumber: string | null; quotaDigit: string | null };

/**
 * Que campos do Processo recebem o grupo/cota que o administrativo salvou. Só
 * escreve onde o Processo está vazio ou ainda guarda o valor anterior do
 * cadastro: o que a pós-contemplação ajustou à mão nunca é sobrescrito.
 */
export function decideProcessQuotaUpdate(
  process: { groupNumber: string | null; quotaNumber: string | null },
  prev: QuotaFields,
  next: QuotaFields,
): { groupNumber?: string | null; quotaNumber?: string | null } {
  const data: { groupNumber?: string | null; quotaNumber?: string | null } = {};
  const nextGroup = next.groupNumber?.trim() || null;
  const prevGroup = prev.groupNumber?.trim() || null;
  if (nextGroup !== prevGroup && (!process.groupNumber || process.groupNumber === prevGroup)) data.groupNumber = nextGroup;
  const nextQuota = quotaWithDigit(next.quotaNumber, next.quotaDigit);
  const prevQuota = quotaWithDigit(prev.quotaNumber, prev.quotaDigit);
  if (nextQuota !== prevQuota && (!process.quotaNumber || process.quotaNumber === prevQuota)) data.quotaNumber = nextQuota;
  return data;
}
