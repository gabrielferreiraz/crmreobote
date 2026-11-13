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

export type ExtraQuota = {
  /** Só dígitos, como o grupo da cota principal. */
  groupNumber: string | null;
  termMonths: number | null;
  /** Valor do crédito, em reais. */
  value: number | null;
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
      return parts.join(" · ") || "cota em branco";
    })
    .join("; ");
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
