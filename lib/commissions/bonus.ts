/**
 * Bônus por meta batida — núcleo PURO (sem banco), mesmo espírito de
 * lib/commissions/engine.ts. Quem toca o banco é bonus-run.ts.
 *
 * Regra decidida com o usuário (03/11/2026): várias faixas (tiers) numa
 * regra só, cada uma com um % da meta individual e um prêmio — fixo em R$ ou
 * percentual extra em cima do total vendido no mês (a pessoa escolhe por
 * faixa). Só a faixa mais ALTA atingida paga — nunca soma faixas (bateu
 * 150% da meta com faixas em 80/100/120% paga só a de 120%, não as três).
 */

export type BonusRewardType = "FIXED" | "PERCENT";

export type BonusTierLike = {
  id: string;
  thresholdPercent: number;
  rewardType: BonusRewardType;
  rewardValue: number;
};

/** % da meta atingido — 2 casas, nunca negativo (meta <= 0 não divide por zero). */
export function computeAchievedPercent(achievedCents: number, goalCents: number): number {
  if (goalCents <= 0) return 0;
  return Math.max(0, Math.round((achievedCents / goalCents) * 10000) / 100);
}

/** Faixa mais alta cujo limiar foi atingido. Null = nenhuma faixa batida ainda. */
export function pickBonusTier<T extends BonusTierLike>(tiers: T[], achievedPercent: number): T | null {
  const eligible = tiers.filter((t) => achievedPercent >= t.thresholdPercent);
  if (eligible.length === 0) return null;
  return eligible.reduce((best, t) => (t.thresholdPercent > best.thresholdPercent ? t : best));
}

/** Prêmio da faixa, em centavos — FIXED usa o valor direto, PERCENT aplica sobre o total vendido no mês. */
export function bonusAmountCents(tier: BonusTierLike, achievedCents: number): number {
  if (tier.rewardType === "FIXED") return Math.round(tier.rewardValue * 100);
  return Math.round((achievedCents * tier.rewardValue) / 100);
}

/** Frase do que a faixa paga — "ganha R$ 1.000,00" / "ganha +0,50% nas vendas do mês". */
export function tierRewardLabel(tier: Pick<BonusTierLike, "rewardType" | "rewardValue">): string {
  if (tier.rewardType === "FIXED") {
    return `ganha R$ ${tier.rewardValue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `ganha +${tier.rewardValue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% nas vendas do mês`;
}

/** "Bateu 100% da meta individual do mês" — texto do CommissionEntry.note. */
export function bonusEntryNote(thresholdPercent: number, achievedPercent: number): string {
  return `Bônus de meta — bateu ${achievedPercent.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% da meta individual do mês (faixa de ${thresholdPercent.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%).`;
}
