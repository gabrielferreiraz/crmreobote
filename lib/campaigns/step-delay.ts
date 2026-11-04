/**
 * Espera entre as mensagens de um script.
 *
 * O consultor define um tempo-base ("10 segundos"); o envio real nunca é
 * cravado nele: sorteia dentro de uma faixa em volta, para a sequência não sair
 * com um ritmo mecânico (5 s → de 4 a 8 s; 10 s → de 8 a 15 s). A MESMA conta
 * alimenta o envio, as estimativas e o que a tela mostra ao consultor, então o
 * que aparece escrito é exatamente o que acontece.
 */

/** Tempo-base sugerido ao criar uma mensagem nova. */
export const DEFAULT_STEP_DELAY_SEC = 10;

export type StepDelayBounds = { min: number; max: number };

/** Faixa (em segundos inteiros) em que a espera real cai para um tempo-base. */
export function stepDelayBounds(baseSec: number): StepDelayBounds {
  const base = Math.max(0, Math.round(Number.isFinite(baseSec) ? baseSec : 0));
  if (base === 0) return { min: 0, max: 0 };
  return { min: Math.max(1, Math.round(base * 0.8)), max: base + Math.ceil(base / 2) };
}

/** Espera real, em milissegundos, sorteada na faixa do tempo-base. */
export function randomStepDelayMs(baseSec: number, random: () => number = Math.random): number {
  const { min, max } = stepDelayBounds(baseSec);
  if (max === 0) return 0;
  return Math.round((min + random() * (max - min)) * 1000);
}

/** Média da faixa, para estimar quanto uma rodada leva. */
export function averageStepDelaySec(baseSec: number): number {
  const { min, max } = stepDelayBounds(baseSec);
  return (min + max) / 2;
}

/** "de 8 a 15 segundos" — o texto mostrado ao consultor. */
export function describeStepDelayRange(baseSec: number): string {
  const { min, max } = stepDelayBounds(baseSec);
  return `de ${min} a ${max} segundos`;
}
