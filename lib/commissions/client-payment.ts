/**
 * "O cliente pagou a parcela deste mês?" — o ✓ do Financeiro (ver
 * CommissionClientPayment). Um lugar só pra regra de QUANDO uma parcela de
 * comissão pode ser paga, usada pela tela (status de cada linha) e pelas
 * rotas de pagamento (que recusam/pulam o que não foi conferido).
 *
 * Sem dependência de servidor: o `where` abaixo é um objeto comum do Prisma.
 */

import type { UnpaidPolicy } from "@/lib/commissions/engine";

/**
 * - PAID: o Financeiro marcou que pagou (ou o cliente é débito automático);
 * - UNPAID: marcou que NÃO pagou (a regra da administradora já foi aplicada);
 * - PENDING: ainda ninguém conferiu — a comissão espera;
 * - NOT_REQUIRED: ajuste avulso, ou administradora que não depende disso.
 */
export type ClientPaymentState = "PAID" | "UNPAID" | "PENDING" | "NOT_REQUIRED";

export function clientPaymentState(input: {
  hasSale: boolean;
  policy: UnpaidPolicy | null;
  autoDebit: boolean;
  /** O ✓ daquele mês, se existir. */
  paid: boolean | null;
}): ClientPaymentState {
  if (!input.hasSale || !input.policy || input.policy === "IGNORE") return "NOT_REQUIRED";
  if (input.paid === true) return "PAID";
  if (input.paid === false) return "UNPAID";
  return input.autoDebit ? "PAID" : "PENDING";
}

/** Parcela pode ser paga quanto ao pagamento do cliente? */
export const clientAllowsPayment = (state: ClientPaymentState) => state === "PAID" || state === "NOT_REQUIRED";

/**
 * `where` de CommissionEntry: parcelas de `month` liberadas quanto ao
 * pagamento do cliente — ajuste avulso, administradora que não confere, ✓
 * marcado, ou débito automático sem "não pagou" marcado.
 */
export function clientConfirmedWhere(month: string) {
  return {
    OR: [
      { saleId: null },
      {
        sale: {
          status: "ACTIVE" as const,
          OR: [
            { administrator: { unpaidPolicy: "IGNORE" as const } },
            { clientPayments: { some: { month, paid: true } } },
            { autoDebit: true, clientPayments: { none: { month, paid: false } } },
          ],
        },
      },
    ],
  };
}

/** O que acontece quando o cliente não paga — frase pra tela e pro aviso. */
export const UNPAID_POLICY_EFFECT: Record<Exclude<UnpaidPolicy, "IGNORE">, string> = {
  HOLD: "comissão adiada",
  FORFEIT: "comissão perdida",
  DEFER: "comissão adiada",
};
