/**
 * Cotas aderidas a uma proposta — as linhas da tabela "Cotas de Bens Imóveis"
 * que vai na folha do documento.
 *
 * Cada cota é uma LINHA de uma tabela Servopa (categoria A1, B1…), escolhida
 * no "Ver" do grupo dentro do modal da proposta. Valor da cota, prazo, taxa e
 * parcela vêm de lá; a quantidade de cotas é a única coisa digitada.
 *
 * Dinheiro em centavos, como no resto das tabelas (lib/servopa-tables/adjust):
 * a parcela que a Servopa publica é a verdade, e multiplicar string decimal em
 * float introduziria centavo fantasma na soma de 8 cotas.
 */

import { fromUnits, toUnits } from "@/lib/servopa-tables/adjust";

export type AdheredQuota = {
  /** Tabela de origem (grupo + prazo + taxa). */
  tableId: string;
  groupNumber: string;
  termMonths: number;
  /** Taxa de ADM já com o ajuste da organização. */
  admEffective: string;
  /** Fundo de reserva do grupo; soma com a ADM para formar a taxa da tabela. */
  reserveFundPercent: string | null;
  /** Categoria da linha: "A1", "B1"… */
  category: string;
  /** Valor da cota — `creditValue` da linha. */
  creditValue: string;
  /** Parcela de UMA cota — `installment` da linha. */
  installment: string;
  /** Digitado pelo consultor. */
  cotas: number;
};

function quantidade(cotas: string | number): number {
  const n = typeof cotas === "number" ? cotas : parseInt(cotas.replace(/\D/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Parcela inicial da linha: a parcela de uma cota vezes a quantidade.
 *
 * Não é derivável de `soma × (1 + taxa) / prazo` — fundo de reserva e seguro
 * variam por grupo, e a Servopa trunca os centavos. Por isso a parcela sai
 * sempre da linha da tabela, nunca de uma fórmula.
 */
export function calcularParcelaInicial(cotas: string | number, parcelaDaCota: string): string {
  return fromUnits(toUnits(parcelaDaCota, 2) * quantidade(cotas), 2);
}

/**
 * A "Taxa Adm." da tabela do documento: a taxa de administração MAIS o fundo
 * de reserva do grupo. São duas colunas separadas na Servopa, mas é a soma
 * das duas que aparece na planilha e que entra no cálculo mensal
 * (ver lib/servopa-tables/adjust: `% mensal = (1 + adm + fundo) / prazo`).
 */
export function calcularTaxaTotal(admPercent: string, reserveFundPercent: string | null): string {
  return fromUnits(toUnits(admPercent, 4) + toUnits(reserveFundPercent ?? "0", 4), 4);
}

/** "Soma por grupo": valor da cota vezes a quantidade. */
export function calcularSomaPorGrupo(cotas: string | number, valorDaCota: string): string {
  return fromUnits(toUnits(valorDaCota, 2) * quantidade(cotas), 2);
}

/** Linha TOTAIS da tabela. */
export function totalizarQuotas(quotas: AdheredQuota[]): { credito: string; parcela: string; cotas: number } {
  let credito = 0;
  let parcela = 0;
  let cotas = 0;
  for (const q of quotas) {
    const n = quantidade(q.cotas);
    credito += toUnits(q.creditValue, 2) * n;
    parcela += toUnits(q.installment, 2) * n;
    cotas += n;
  }
  return { credito: fromUnits(credito, 2), parcela: fromUnits(parcela, 2), cotas };
}
