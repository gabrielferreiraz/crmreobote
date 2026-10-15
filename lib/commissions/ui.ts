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
  entry: { status: "SCHEDULED" | "ON_HOLD" | "PAID" | "CANCELLED"; paymentMonth: string },
  currentMonth: string,
  audience: "seller" | "manager",
): DisplayStatus {
  if (entry.status === "PAID") return { label: "Pago", tone: "success" };
  if (entry.status === "ON_HOLD") return { label: "Travado", tone: "warning" };
  if (entry.status === "CANCELLED") return { label: "Cancelado", tone: "neutral" };
  if (entry.paymentMonth > currentMonth) return { label: "Previsto", tone: "neutral" };
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
  },
  opts: { withAdministrator?: boolean; withMonth?: boolean; withClient?: boolean } = {},
): string {
  const parts: string[] = [];
  if (entry.kind === "ADJUSTMENT") {
    parts.push(opts.withClient && entry.clientName ? `ajuste na venda de ${entry.clientName}` : "ajuste lançado pelo Financeiro");
  } else {
    if (opts.withClient && entry.clientName) parts.push(entry.clientName);
    if (opts.withAdministrator && entry.administratorName) parts.push(entry.administratorName);
    parts.push(
      entry.installmentCount && entry.installmentCount > 1 ? `parcela ${entry.installmentNumber} de ${entry.installmentCount}` : "parcela única",
    );
    if (entry.role !== "SELLER") parts.push(`como ${ROLE_LABELS[entry.role].toLowerCase()}`);
  }
  if (opts.withMonth) parts.push(`para ${formatMonthLong(entry.paymentMonth).toLowerCase()}`);
  if (entry.paidByAdministrator) parts.push("paga direto pela administradora");
  const text = parts.join(", ");
  const sentence = `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
  // "Pago antes do sistema" (venda antiga) é observação da própria parcela.
  return entry.kind === "INSTALLMENT" && entry.note ? `${sentence} ${entry.note}.` : sentence;
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
