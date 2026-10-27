/**
 * Desconto/acréscimo na taxa de ADM de uma tabela Servopa, em PONTOS
 * PERCENTUAIS (ex.: taxa 10% com ajuste -1,5 → 8,5%).
 *
 * Regra de ouro: o que o site da Servopa publica é a verdade. Com ajuste 0 as
 * linhas saem EXATAMENTE como a Servopa publica (nada é recalculado). Só com
 * ajuste ≠ 0 há conta — e ela replica o arredondamento do próprio site
 * (verificado nas 2.928 linhas coletadas em 23/10/2026, ver CLAUDE.md do
 * projeto de tabelas):
 *
 *   % mensal  = (1 + taxaADM + fundoReserva) / prazo        (arredondado em 4 casas, em %)
 *   parcela   = valor do crédito × % mensal já arredondado  (centavos TRUNCADOS, como a Servopa faz)
 *   seguro    = o que a Servopa publica (o ajuste NÃO mexe no seguro)
 *   total     = parcela + seguro
 *
 * Aritmética toda em inteiros (nada de float em dinheiro): percentuais em
 * unidades de 0,0001 p.p., dinheiro em centavos.
 */

import type { NormalizedRow } from "@/lib/servopa-tables/types";

/** "13.0000" → 130000 (escala 4); "1075.69" → 107569 (escala 2). */
export function toUnits(value: string, scale: number): number {
  const m = value.trim().match(/^(-)?(\d+)(?:\.(\d+))?$/);
  if (!m) throw new Error(`Decimal inválido: "${value}"`);
  const frac = (m[3] ?? "").padEnd(scale, "0");
  if (frac.length > scale && /[1-9]/.test(frac.slice(scale))) throw new Error(`Decimal com casas demais: "${value}"`);
  const n = Number(m[2] + frac.slice(0, scale));
  return m[1] ? -n : n;
}

/** 107569 (escala 2) → "1075.69". */
export function fromUnits(units: number, scale: number): string {
  const neg = units < 0;
  const s = String(Math.abs(units)).padStart(scale + 1, "0");
  const out = `${s.slice(0, s.length - scale)}.${s.slice(s.length - scale)}`;
  return neg ? `-${out}` : out;
}

/** Divisão inteira arredondando metade pra cima (n ≥ 0, d > 0). */
function divRound(n: number, d: number): number {
  return Math.floor((2 * n + d) / (2 * d));
}

/** Taxa efetiva ("13.0000" + "-1.5000" → "11.5000"). Lança se ficar negativa. */
export function effectiveAdmRate(admRatePercent: string, adjustmentPoints: string): string {
  const eff = toUnits(admRatePercent, 4) + toUnits(adjustmentPoints, 4);
  if (eff < 0) throw new Error("O desconto deixaria a taxa de administração negativa");
  return fromUnits(eff, 4);
}

export type AdjustInput = {
  admRatePercent: string;
  adjustmentPoints: string;
  termMonths: number;
  /** Fundo de reserva do grupo, em % ("0.5000"). Obrigatório quando há ajuste. */
  reserveFundPercent: string | null;
};

export type PricedRow = Pick<
  NormalizedRow,
  "category" | "description" | "creditValue" | "termMonths" | "monthlyPercent" | "installment" | "insurance" | "observation" | "total"
>;

/** Uma linha pela regra acima, a partir da taxa efetiva (sem olhar o que o site publicou). */
export function computeRow<T extends PricedRow>(row: T, effectiveAdmRatePercent: string, reserveFundPercent: string): T {
  const m4 = divRound(1_000_000 + toUnits(effectiveAdmRatePercent, 4) + toUnits(reserveFundPercent, 4), row.termMonths);
  // A Servopa TRUNCA os centavos da parcela (não arredonda) — confirmado linha a linha.
  const installmentCents = Math.floor((toUnits(row.creditValue, 2) * m4) / 1_000_000);
  return {
    ...row,
    monthlyPercent: fromUnits(m4, 4),
    installment: fromUnits(installmentCents, 2),
    total: fromUnits(installmentCents + toUnits(row.insurance, 2), 2),
  };
}

/**
 * Linhas como devem aparecer/imprimir: ajuste 0 → exatamente as do site;
 * ajuste ≠ 0 → recalculadas. `admRatePercent` devolvido é a taxa efetiva.
 */
export function applyAdjustment<T extends PricedRow>(input: AdjustInput, rows: T[]): { admRatePercent: string; rows: T[] } {
  if (toUnits(input.adjustmentPoints, 4) === 0) return { admRatePercent: input.admRatePercent, rows };
  if (input.reserveFundPercent === null) throw new Error("Grupo sem fundo de reserva: não dá para recalcular com desconto/acréscimo");
  const eff = effectiveAdmRate(input.admRatePercent, input.adjustmentPoints);
  return { admRatePercent: eff, rows: rows.map((r) => computeRow(r, eff, input.reserveFundPercent as string)) };
}
