/**
 * Matemática PURA da divisão do negócio entre responsáveis (sem prisma — usada
 * no servidor, na tela e nos testes). A parte do responsável PRINCIPAL nunca é
 * guardada: é o que sobra (100 − soma dos co-responsáveis), então a divisão
 * não tem como sair de 100%.
 */

export type SplitParticipantInput = { userId: string; sharePercent: number };
export type DealShare = { userId: string; percent: number; isPrincipal: boolean };

/** Teto de co-responsáveis por negócio (além do principal). */
export const MAX_CO_OWNERS = 5;

/** Principal primeiro, depois os co-responsáveis na ordem recebida. */
export function computeDealShares(ownerId: string, participants: SplitParticipantInput[]): DealShare[] {
  const coTotal = participants.reduce((sum, p) => sum + p.sharePercent, 0);
  return [
    { userId: ownerId, percent: 100 - coTotal, isPrincipal: true },
    ...participants.map((p) => ({ userId: p.userId, percent: p.sharePercent, isPrincipal: false })),
  ];
}

/**
 * Divisão igual entre `people` pessoas (principal incluso): cada co-responsável
 * leva o piso e o principal fica com o resto — 2 pessoas = 50/50, 3 = 34/33/33.
 */
export function equalSplit(people: number): { principal: number; coOwner: number } {
  const n = Math.max(1, Math.floor(people));
  const coOwner = Math.floor(100 / n);
  return { principal: 100 - coOwner * (n - 1), coOwner };
}

export type SplitValidation = { ok: true } | { ok: false; error: string };

export function validateSplit(ownerId: string, participants: SplitParticipantInput[]): SplitValidation {
  if (participants.length > MAX_CO_OWNERS) {
    return { ok: false, error: `No máximo ${MAX_CO_OWNERS} co-responsáveis por negócio.` };
  }
  const seen = new Set<string>();
  let total = 0;
  for (const p of participants) {
    if (typeof p.userId !== "string" || !p.userId) return { ok: false, error: "Co-responsável inválido." };
    if (p.userId === ownerId) return { ok: false, error: "O responsável principal já faz parte do negócio." };
    if (seen.has(p.userId)) return { ok: false, error: "Co-responsável repetido." };
    seen.add(p.userId);
    if (!Number.isInteger(p.sharePercent) || p.sharePercent < 1 || p.sharePercent > 99) {
      return { ok: false, error: "A parte de cada co-responsável precisa ser um número inteiro de 1% a 99%." };
    }
    total += p.sharePercent;
  }
  if (total > 99) return { ok: false, error: "As partes dos co-responsáveis somam demais: o responsável principal precisa ficar com pelo menos 1%." };
  return { ok: true };
}

/** Parte de `value` que cabe a `percent` (em reais, arredondada pra centavos). */
export function shareOfValue(value: number, percent: number): number {
  return Math.round(value * percent) / 100;
}

/**
 * Reparte `totalCents` entre as pessoas pela porcentagem, sem perder centavo:
 * a soma das partes é SEMPRE `totalCents` (o resto vai pro maior percentual,
 * que no desempate é o primeiro da lista = principal).
 */
export function splitCentsByPercent(totalCents: number, shares: { percent: number }[]): number[] {
  if (shares.length === 0) return [];
  const parts = shares.map((s) => Math.floor((totalCents * s.percent) / 100));
  let remainder = totalCents - parts.reduce((a, b) => a + b, 0);
  const order = shares
    .map((s, index) => ({ index, percent: s.percent }))
    .sort((a, b) => b.percent - a.percent || a.index - b.index);
  for (let i = 0; remainder > 0; i = (i + 1) % order.length) {
    parts[order[i].index] += 1;
    remainder -= 1;
  }
  return parts;
}
