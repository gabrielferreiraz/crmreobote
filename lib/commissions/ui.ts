/**
 * Rótulos/cores das telas de Comissões — um lugar só, pra "Travado" ser o
 * mesmo amarelo na tela do consultor, do Financeiro e no painel da venda.
 * Sem dependência de servidor (usado em componente de cliente).
 */

import type { BadgeTone } from "@/components/badge";
import { formatMonthLong, ROLE_LABELS, type BeneficiaryRole } from "@/lib/commissions/engine";

export type DisplayStatus = { label: string; tone: BadgeTone };

/**
 * Status como a PESSOA entende — depende do mês: parcela não paga do mês
 * atual é "A receber", de mês futuro é "Previsto". Pro Financeiro, não paga
 * de mês que já passou é "Atrasado"; pro consultor continua "A receber"
 * (é dinheiro que ele vai receber, não um erro dele).
 */
export function entryDisplayStatus(
  entry: {
    status: "SCHEDULED" | "ON_HOLD" | "PAID" | "CANCELLED";
    paymentMonth: string;
    /** O cliente pagou a parcela do mês? (ver lib/commissions/client-payment.ts) */
    clientPayment?: "PAID" | "UNPAID" | "PENDING" | "NOT_REQUIRED";
    clientPaymentEffect?: "HOLD" | "FORFEIT" | "DEFER" | null;
  },
  currentMonth: string,
  audience: "seller" | "manager",
): DisplayStatus {
  if (entry.status === "PAID") return { label: "Pago", tone: "success" };
  if (entry.status === "ON_HOLD") return { label: "Travado", tone: "warning" };
  // Cancelada porque o cliente não pagou (regra da administradora): "perdida", não um cancelamento qualquer.
  if (entry.status === "CANCELLED") return entry.clientPaymentEffect === "FORFEIT" ? { label: "Perdida", tone: "danger" } : { label: "Cancelado", tone: "neutral" };
  if (entry.paymentMonth > currentMonth) return { label: "Previsto", tone: "neutral" };
  // Mês chegou e ninguém conferiu ainda se o cliente pagou a parcela.
  if (entry.clientPayment === "PENDING") return { label: "Aguardando o cliente", tone: "warning" };
  if (entry.paymentMonth < currentMonth && audience === "manager") return { label: "Atrasado", tone: "danger" };
  return { label: "A receber", tone: "brand" };
}

/**
 * A linha de baixo de uma parcela, como FRASE — "Servopa, parcela 3 de 10,
 * como supervisor." — em vez de etiquetas soltas separadas por ponto
 * ("Servopa · 3 de 10 · Supervisor"), que quem não é de tecnologia não lê.
 * Mesmo texto em toda tela (Financeiro, painel da venda, consultor).
 */
export function entryDescription(
  entry: {
    kind: "INSTALLMENT" | "ADJUSTMENT";
    installmentNumber: number | null;
    installmentCount: number | null;
    role: BeneficiaryRole;
    administratorName: string | null;
    clientName: string | null;
    paymentMonth: string;
    paidByAdministrator: boolean;
    note: string | null;
    /** Mês original de uma parcela empurrada pro mês seguinte (cliente não pagou). */
    deferredFromMonth?: string | null;
  },
  opts: { withAdministrator?: boolean; withMonth?: boolean; withClient?: boolean } = {},
): string {
  const parts: string[] = [];
  if (entry.kind === "ADJUSTMENT") {
    parts.push(opts.withClient && entry.clientName ? `ajuste · ${entry.clientName}` : "ajuste");
  } else {
    if (opts.withClient && entry.clientName) parts.push(entry.clientName);
    if (opts.withAdministrator && entry.administratorName) parts.push(entry.administratorName);
    parts.push(
      entry.installmentCount && entry.installmentCount > 1 ? `parcela ${entry.installmentNumber}/${entry.installmentCount}` : "parcela única",
    );
    if (entry.role !== "SELLER") parts.push(`como ${ROLE_LABELS[entry.role].toLowerCase()}`);
  }
  if (opts.withMonth) parts.push(formatMonthLong(entry.paymentMonth).toLowerCase());
  if (entry.paidByAdministrator) parts.push("paga pela administradora");
  if (entry.deferredFromMonth) parts.push(`adiada de ${formatMonthLong(entry.deferredFromMonth, { withYear: false }).toLowerCase()}`);
  // "Pago antes do sistema" (venda antiga) é observação da própria parcela.
  if (entry.kind === "INSTALLMENT" && entry.note) parts.push(entry.note);
  const text = parts.join(" · ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** Rótulo do status quando é a administradora que paga direto (sem sigla). */
export const PAID_BY_ADMINISTRATOR_LABEL = "Pago pela administradora";

/** "Parcela 3 de 10" / "Ajuste" — o "o quê" de uma linha. */
export function entryWhat(entry: {
  kind: "INSTALLMENT" | "ADJUSTMENT";
  installmentNumber: number | null;
  installmentCount: number | null;
}): string {
  if (entry.kind === "ADJUSTMENT") return "Ajuste";
  if (entry.installmentCount && entry.installmentCount > 1) return `${entry.installmentNumber} de ${entry.installmentCount}`;
  return "Parcela única";
}
