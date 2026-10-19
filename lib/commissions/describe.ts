import {
  buildSaleSchedule,
  formatPercent,
  MODALITY_LABELS,
  ROLE_LABELS,
  type AdministratorLike,
  type Base,
  type CommissionTableLike,
  type UnpaidPolicy,
  type BeneficiaryRole,
  type Modality,
  type RevenueMode,
  type RuleLike,
} from "@/lib/commissions/engine";
import { formatCurrency } from "@/lib/format";

const BASE_SHORT: Record<Base, string> = { NET: "do líquido", GROSS: "do bruto", COMPANY_REVENUE: "do que a corretora recebe" };

/** Frase curta de uma regra — pro registro de auditoria ("Vendedor · Fulano · Servopa · 1,2% do líquido"). */
export function describeRule(rule: {
  beneficiaryRole: BeneficiaryRole;
  user?: { name: string } | null;
  administrator?: { name: string } | null;
  modality: Modality | null;
  creditType: string | null;
  base: Base;
  percent: number | { toString(): string };
}): string {
  const parts = [
    ROLE_LABELS[rule.beneficiaryRole],
    rule.user?.name ?? "todos",
    rule.administrator?.name ?? "todas as administradoras",
  ];
  if (rule.modality) parts.push(MODALITY_LABELS[rule.modality]);
  if (rule.creditType) parts.push(rule.creditType);
  parts.push(`${formatPercent(Number(rule.percent))} ${BASE_SHORT[rule.base]}`);
  return parts.join(" · ");
}

// ─── Frases de tela ──────────────────────────────────────────────────
//
// A configuração é lida por quem não é de tecnologia: cada regra e cada
// administradora aparece como UMA frase em português corrido, com o que
// importa em negrito — nunca uma fileira de etiquetas soltas ("10x · corte
// 25 · direto"). Partes: texto comum (string) ou destaque ({ strong }).

export type SentencePart = string | { strong: string };

export function ruleSentence(rule: {
  beneficiaryRole: BeneficiaryRole;
  userName: string | null;
  administratorName: string | null;
  modality: Modality | null;
  creditType: string | null;
  base: Base;
  percent: number;
}): SentencePart[] {
  const parts: SentencePart[] = [];
  if (rule.beneficiaryRole === "SELLER") {
    parts.push(rule.userName ? { strong: rule.userName } : "Todo vendedor");
  } else {
    const role = rule.beneficiaryRole === "SUPERVISOR" ? "supervisor" : "gerente";
    if (rule.userName) parts.push(`O ${role} `, { strong: rule.userName });
    else parts.push(`Todo ${role}`);
  }
  parts.push(" ganha ", { strong: formatPercent(rule.percent) });
  parts.push(rule.base === "COMPANY_REVENUE" ? " do que a corretora recebe" : ` do valor ${rule.base === "GROSS" ? "bruto" : "líquido"}`);
  parts.push(rule.beneficiaryRole === "SELLER" ? " nas vendas" : " nas vendas da equipe");
  if (rule.modality === "REDUCED") parts.push(" em meia parcela");
  if (rule.modality === "FULL") parts.push(" em parcela cheia");
  if (rule.creditType) parts.push(" de ", { strong: rule.creditType });
  if (rule.administratorName) parts.push(" da ", { strong: rule.administratorName });
  else parts.push(" de qualquer administradora");
  parts.push(".");
  return parts;
}

export function graceSentence(months: number): string {
  if (months === 0) return "no mesmo mês";
  if (months === 1) return "no mês seguinte";
  return `${months} meses depois`;
}

/** "1,5%, 0,5% e 0,5%" — no máximo 3 itens; o resto vira "e mais N". */
function listPercents(percents: number[]): string {
  const shown = percents.slice(0, 3).map(formatPercent);
  const rest = percents.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} e mais ${rest}`;
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} e ${shown.at(-1)}` : (shown[0] ?? "");
}

/** "2ª" / "2ª e 5ª" / "2ª, 5ª e 7ª". */
function listOrdinals(numbers: number[]): string {
  const items = numbers.map((n) => `${n}ª`);
  return items.length > 1 ? `${items.slice(0, -1).join(", ")} e ${items.at(-1)}` : (items[0] ?? "");
}

/**
 * Uma tabela de comissão numa frase — quanto a administradora paga pra
 * corretora, em quantas vezes, quais parcelas não têm comissão e quando sai
 * a primeira.
 */
export function tableSentence(t: Omit<CommissionTableLike, "creditType">, graceMonths: number): SentencePart[] {
  const parts: SentencePart[] = [];
  const count = t.commissionInstallments;
  const base = t.revenueBase === "GROSS" ? "bruto" : "líquido";
  const paying = t.revenuePercents?.filter((_, i) => !t.skippedInstallments.includes(i + 1)) ?? [];

  if (t.revenueMode === "CREDIT_EQUAL" && t.revenueTotalPercent != null) {
    parts.push("Paga à corretora ", { strong: `${formatPercent(t.revenueTotalPercent)} do ${base}` });
    parts.push(count === 1 ? ", de uma vez" : `, em ${count}x`);
  } else if (t.revenueMode === "CREDIT_TABLE" && t.revenuePercents) {
    const total = paying.reduce((x, y) => x + y, 0);
    parts.push("Paga à corretora ", { strong: `${formatPercent(Math.round(total * 10000) / 10000)} do ${base}` }, ` em ${count}x (${listPercents(paying)})`);
  } else if (t.revenueMode === "CLIENT_INSTALLMENT_TABLE" && t.revenuePercents) {
    parts.push("Paga à corretora ", { strong: listPercents(paying) }, ` da parcela do cliente, em ${count}x`);
  } else {
    parts.push("Paga ", { strong: count === 1 ? "de uma vez" : `em ${count} parcelas` });
  }
  if (t.skippedInstallments.length > 0) parts.push(", ", { strong: `sem comissão na ${listOrdinals(t.skippedInstallments)}` });
  parts.push(", 1ª ", { strong: graceSentence(graceMonths) }, ".");
  return parts;
}

const UNPAID_SENTENCE: Record<UnpaidPolicy, string> = {
  IGNORE: "Não depende do cliente pagar.",
  HOLD: "Recebe quando o cliente pagar.",
  FORFEIT: "Cliente não pagou: consultor perde.",
  DEFER: "Recebe quando o cliente pagar.",
};

/** O que vale pra administradora inteira (corte, quem paga, cliente que não pagou). */
export function administratorGeneralSentence(a: { cutoffDay: number | null; paysSellerDirectly: boolean; unpaidPolicy: UnpaidPolicy }): SentencePart[] {
  const parts: SentencePart[] = [];
  if (a.cutoffDay != null) parts.push("Corte dia ", { strong: String(a.cutoffDay) }, ". ");
  parts.push(a.paysSellerDirectly ? "Paga o consultor direto. " : "Empresa paga o consultor. ");
  parts.push(UNPAID_SENTENCE[a.unpaidPolicy]);
  return parts;
}

// ─── "Na prática": quanto a corretora recebe x quanto vai pra cada um ────

/** Venda de exemplo das prévias — crédito de R$ 100 mil e mensalidade de R$ 1 mil. */
export const EXAMPLE_SALE = { value: 100_000, clientInstallment: 1_000 };

export type ExampleSplit = {
  /** O que a corretora recebe da administradora (null = não informado). */
  revenue: number | null;
  /** O que o vendedor/supervisor/gerente recebem por essa venda, pela regra geral de cada papel. */
  commissions: { role: BeneficiaryRole; amount: number }[];
  /** O que sobra pra corretora (null quando não dá pra saber o que ela recebe). */
  remaining: number | null;
  /** Administradora paga o consultor direto — o "fica pra corretora" desconta só a liderança. */
  paysSellerDirectly: boolean;
};

/**
 * A conta de uma venda de exemplo numa administradora, usando o MESMO motor
 * da comissão de verdade: quanto a corretora recebe, quanto cada papel
 * recebe (pela regra geral — "todo vendedor", "todo supervisor") e quanto
 * fica. Vendedor/supervisor/gerente fictícios só pra a regra de cada papel
 * entrar.
 */
export function exampleSplit(administrator: AdministratorLike, rules: RuleLike[], creditType: string | null = null): ExampleSplit {
  // Regras "de todos" (sem pessoa, parcela cheia) — as de categoria entram
  // e a mais específica vence normalmente.
  const generic = rules.filter((r) => r.userId === null && r.modality !== "REDUCED");
  const { installments, revenue } = buildSaleSchedule(
    {
      sellerId: "__seller",
      supervisorId: "__supervisor",
      managerId: "__manager",
      administratorId: administrator.id,
      modality: "FULL",
      creditType,
      saleDate: new Date(),
      netValue: EXAMPLE_SALE.value,
      grossValue: EXAMPLE_SALE.value,
      clientInstallment: EXAMPLE_SALE.clientInstallment,
    },
    administrator,
    generic,
  );
  const byRole = new Map<BeneficiaryRole, number>();
  for (const i of installments) byRole.set(i.role, (byRole.get(i.role) ?? 0) + i.amountCents);
  const commissions = Array.from(byRole.entries()).map(([role, cents]) => ({ role, amount: cents / 100 }));
  const revenueTotal = revenue.length > 0 ? revenue.reduce((acc, r) => acc + r.amountCents, 0) / 100 : null;
  // O que a administradora paga direto pro vendedor não sai do que a corretora recebe.
  const paidByCompany = commissions.filter((c) => !(c.role === "SELLER" && administrator.paysSellerDirectly)).reduce((acc, c) => acc + c.amount, 0);
  return {
    revenue: revenueTotal,
    commissions,
    remaining: revenueTotal != null ? revenueTotal - paidByCompany : null,
    paysSellerDirectly: administrator.paysSellerDirectly,
  };
}

/** A conta de exemplo como frases ("A corretora recebe R$ 5.000. Todo vendedor recebe R$ 1.000. Ficam R$ 4.000 para a corretora."). */
export function exampleSplitSentences(split: ExampleSplit, administratorName: string, mode: RevenueMode | null): SentencePart[][] {
  const lines: SentencePart[][] = [];
  const saleText =
    mode === "CLIENT_INSTALLMENT_TABLE"
      ? `Parcela de ${formatCurrency(EXAMPLE_SALE.clientInstallment)}`
      : `Venda de ${formatCurrency(EXAMPLE_SALE.value)}`;
  if (split.revenue != null) {
    lines.push([`${saleText}: corretora recebe `, { strong: formatCurrency(split.revenue) }]);
  } else {
    lines.push([`${saleText}:`]);
  }
  for (const c of split.commissions) {
    const who = c.role === "SELLER" ? "O vendedor" : c.role === "SUPERVISOR" ? "O supervisor" : "O gerente";
    const direct = c.role === "SELLER" && split.paysSellerDirectly ? " (direto da administradora)" : "";
    lines.push([`${who}: `, { strong: formatCurrency(c.amount) }, direct]);
  }
  if (split.commissions.length === 0) lines.push(["Sem regra de vendedor."]);
  if (split.remaining != null) {
    lines.push(["Fica: ", { strong: formatCurrency(split.remaining) }]);
  }
  return lines;
}
