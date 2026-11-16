/**
 * Cotas extras da mesma venda (ver DealRegistration.extraQuotas).
 *
 * Por que uma lista guardada em JSON, e não colunas novas: o cadastro tem UMA
 * cota principal (grupo/prazo/forma de pagamento, que o consultor preenche, e
 * cota/dígito, que o administrativo preenche depois na administradora). Quando
 * a venda fecha mais de uma cota, o que varia é só grupo, prazo e valor — e
 * quantas vezes isso se repete ninguém sabe de antemão. Virar colunas
 * `groupNumber2`, `groupNumber3`… seria uma migração a cada venda maior.
 *
 * Fica FORA do cálculo de "o que falta" de propósito (lib/deal-registration/
 * rules.ts): cota extra é acréscimo, não exigência — ninguém pode ficar
 * impedido de marcar o Ganho porque acrescentou uma linha e não terminou de
 * preencher. Linha totalmente vazia é descartada ao salvar.
 *
 * Sem import de prisma aqui: este arquivo é lido também pelo formulário no
 * navegador.
 */

import { formatCurrency } from "@/lib/format";

/** Cota meia ou integral (Servopa). Ausente = integral. */
export const QUOTA_KINDS = ["MEIA", "INTEGRAL"] as const;
export type QuotaKind = (typeof QUOTA_KINDS)[number];

export function parseQuotaKind(value: unknown): QuotaKind {
  return value === "MEIA" ? "MEIA" : "INTEGRAL";
}

export type ExtraQuota = {
  /** Só dígitos, como o grupo da cota principal. */
  groupNumber: string | null;
  termMonths: number | null;
  /** Valor do crédito, em reais. */
  value: number | null;
  /** Meia ou integral; ausente = integral. */
  kind?: QuotaKind;
};

// Forma de pagamento NÃO entra aqui de propósito: é uma só para a venda
// inteira (fica no campo próprio da seção, abaixo das cotas), não uma por
// cota.

/**
 * Teto de linhas. Não é regra de negócio — é defesa: a coluna é um JSON que
 * vem do navegador, e sem limite um cliente adulterado gravaria uma lista
 * gigante na linha do cadastro.
 */
export const MAX_EXTRA_QUOTAS = 9;

export const EMPTY_EXTRA_QUOTA: ExtraQuota = { groupNumber: null, termMonths: null, value: null };

export function isBlankExtraQuota(q: ExtraQuota): boolean {
  return !q.groupNumber?.trim() && q.termMonths == null && q.value == null;
}

/**
 * Lê o que está gravado na coluna JSON. Tolerante de propósito: a coluna
 * aceita qualquer JSON, então tudo o que não for uma linha reconhecível é
 * descartado em vez de derrubar a tela do cadastro.
 */
export function parseExtraQuotas(value: unknown): ExtraQuota[] {
  if (!Array.isArray(value)) return [];
  const out: ExtraQuota[] = [];
  for (const item of value.slice(0, MAX_EXTRA_QUOTAS)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const group = typeof row.groupNumber === "string" ? row.groupNumber.replace(/\D/g, "").slice(0, 8) : "";
    const term = typeof row.termMonths === "number" && Number.isFinite(row.termMonths) ? Math.trunc(row.termMonths) : null;
    const amount = typeof row.value === "number" && Number.isFinite(row.value) ? row.value : null;
    out.push({
      groupNumber: group || null,
      termMonths: term != null && term >= 1 && term <= 600 ? term : null,
      value: amount != null && amount >= 0 ? amount : null,
      kind: parseQuotaKind(row.kind),
    });
  }
  return out;
}

/**
 * Uma linha de texto com as cotas extras, para a auditoria e para qualquer
 * lugar que precise mostrar isso sem desenhar campo: "grupo 1568 · 180 meses ·
 * R$ 100.000,00; grupo 1572 · R$ 50.000,00". Devolve null quando não há
 * nenhuma, que é como a auditoria representa "sem valor".
 */
export function describeExtraQuotas(list: ExtraQuota[]): string | null {
  const rows = cleanExtraQuotas(list);
  if (rows.length === 0) return null;
  return rows
    .map((q) => {
      const parts: string[] = [];
      if (q.groupNumber) parts.push(`grupo ${q.groupNumber}`);
      if (q.termMonths != null) parts.push(`${q.termMonths} meses`);
      if (q.value != null) parts.push(formatCurrency(q.value));
      if (q.kind === "MEIA") parts.push("meia");
      return parts.join(" · ") || "cota em branco";
    })
    .join("; ");
}

/** Valor que a cota realmente vale na venda: meia = metade do crédito, integral = o crédito inteiro. */
export function effectiveQuotaValue(q: Pick<ExtraQuota, "value" | "kind">): number {
  const value = q.value ?? 0;
  return q.kind === "MEIA" ? value / 2 : value;
}

export type QuotaTotals = {
  /** Soma dos créditos cheios, todas como integral. */
  gross: number;
  /** Soma com as meias divididas por 2. Igual ao bruto quando não há meia. */
  net: number;
  hasHalf: boolean;
};

/**
 * Totais da venda. Somados em centavos inteiros (reais em ponto flutuante
 * dão centavo fantasma); a metade de uma meia arredonda para o centavo.
 * Sem nenhuma meia, é tudo integral e bruto = líquido.
 */
export function calcQuotaTotals(list: Pick<ExtraQuota, "value" | "kind">[]): QuotaTotals {
  let gross = 0;
  let net = 0;
  let hasHalf = false;
  for (const q of list) {
    const cents = Math.round((q.value ?? 0) * 100);
    gross += cents;
    if (q.kind === "MEIA") {
      hasHalf = true;
      net += Math.round(cents / 2);
    } else {
      net += cents;
    }
  }
  return { gross: gross / 100, net: (hasHalf ? net : gross) / 100, hasHalf };
}

/** O que vai para o banco: linhas em branco somem e o teto é respeitado. */
export function cleanExtraQuotas(list: ExtraQuota[]): ExtraQuota[] {
  return list.filter((q) => !isBlankExtraQuota(q)).slice(0, MAX_EXTRA_QUOTAS);
}

/**
 * A administradora que tem tratamento próprio (as tabelas da Servopa já vivem
 * no CRM — ver memory-tabelas-servopa.md). Comparação pelo NOME porque a lista
 * de administradoras é cadastrada pelo usuário em Comissões, não um enum: o id
 * muda de organização para organização, o nome é o que a pessoa escolhe na
 * tela. Sem acento e sem diferenciar maiúsculas para "Servopa" e "SERVOPA"
 * caírem no mesmo lugar.
 */
export function isServopaAdministrator(name: string | null | undefined): boolean {
  return (name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase() === "SERVOPA";
}
