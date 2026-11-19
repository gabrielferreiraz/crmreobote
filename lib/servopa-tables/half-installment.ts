/**
 * "Meia parcela" dos grupos que começam com 21 — regra própria desses grupos,
 * diferente de simplesmente dividir a parcela normal por 2: a Taxa de
 * Administração é cobrada INTEIRA (sobre o crédito cheio); só a devolução do
 * crédito + Fundo de Reserva é que vira meia. Mostrada ao lado da parcela
 * normal (nunca no lugar dela) só nesses grupos — os demais não têm essa
 * coluna.
 *
 *   ADM mensal       = round(round(Crédito × Taxa ADM%) / Prazo)      → guardado
 *   Base             = Crédito + round(Crédito × Fundo de Reserva%)
 *   Base meia mensal = round(round(Base / 2) / Prazo)
 *   Meia parcela     = ADM mensal (guardado) + Base meia mensal
 *
 * Tudo em centavos inteiros, arredondado (metade pra cima) em cada etapa —
 * valor nosso, calculado por nós (a Servopa não publica isso), então não há
 * um arredondamento do site pra replicar; a convenção acima é a mesma usada
 * no resto do módulo (ver adjust.ts).
 */

import { toUnits, fromUnits, divRound } from "./adjust.ts";

export const HALF_INSTALLMENT_GROUP_PREFIX = "21";

/** Grupo "21xx" (qualquer tamanho) tem a regra de meia parcela diferente. */
export function groupHasDifferentHalfInstallment(groupNumber: string): boolean {
  return groupNumber.trim().startsWith(HALF_INSTALLMENT_GROUP_PREFIX);
}

export type HalfInstallmentInput = {
  /** "1075.69" */
  creditValue: string;
  termMonths: number;
  /** Taxa de ADM a usar — a mesma da parcela normal (efetiva, se houver ajuste). */
  admRatePercent: string;
  /** Fundo de reserva do grupo, em % ("0.5000"). null = grupo sem fundo cadastrado (não dá pra calcular). */
  reserveFundPercent: string | null;
};

/** null quando falta o fundo de reserva do grupo. */
export function computeHalfInstallment(input: HalfInstallmentInput): string | null {
  const { creditValue, termMonths, admRatePercent, reserveFundPercent } = input;
  if (reserveFundPercent == null) return null;

  const creditCents = toUnits(creditValue, 2);
  const adm4 = toUnits(admRatePercent, 4);
  const fundo4 = toUnits(reserveFundPercent, 4);

  // ADM mensal: taxa inteira sobre o crédito cheio, sem dividir por 2.
  const admTotalCents = divRound(creditCents * adm4, 1_000_000);
  const admMonthlyCents = divRound(admTotalCents, termMonths);

  // Crédito + Fundo de Reserva, essa parte sim vira meia.
  const reserveFundAmountCents = divRound(creditCents * fundo4, 1_000_000);
  const baseCents = creditCents + reserveFundAmountCents;
  const halfBaseCents = divRound(baseCents, 2);
  const halfBaseMonthlyCents = divRound(halfBaseCents, termMonths);

  return fromUnits(admMonthlyCents + halfBaseMonthlyCents, 2);
}
