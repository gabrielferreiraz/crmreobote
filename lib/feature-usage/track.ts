import type { FeatureKey } from "./features";

/**
 * Contador de uso de funcionalidade — acumula em MEMÓRIA e só vai pro
 * servidor de carona no heartbeat que já roda a cada 30s (ver
 * components/presence-heartbeat.tsx). Ou seja: clicar não custa
 * requisição nenhuma, e um consultor que clica 300 vezes num dia gera as
 * mesmas ~2 requisições por minuto que ele já gerava antes disso existir.
 *
 * Fora de React de propósito (módulo com estado no escopo dele, não um
 * contexto/provider): `trackUse` é chamado de dentro de handler de clique,
 * de função async, de componente que não tem provider por cima — um hook
 * obrigaria a instrumentar via árvore de componentes, que é exatamente o
 * tipo de atrito que faz a medição não ser adicionada nos lugares novos.
 *
 * Perda aceita: o que estiver no buffer quando a aba fecha some (ver
 * flushOnHide em presence-heartbeat.tsx, que reduz mas não elimina). Isso é
 * de propósito — o dado serve pra comparar grandeza entre funcionalidades
 * ("a ação em massa é usada 10x mais que trocar origem"), não pra auditoria
 * exata; perder os últimos segundos de uma aba não muda nenhuma conclusão.
 */
const buffer = new Map<FeatureKey, number>();

export function trackUse(feature: FeatureKey): void {
  if (typeof window === "undefined") return; // no-op no servidor (componente compartilhado que também renderiza no SSR)
  buffer.set(feature, (buffer.get(feature) ?? 0) + 1);
}

/** Esvazia o buffer e devolve o acumulado. Chamado só pelo heartbeat. */
export function drainFeatureUsage(): Record<string, number> {
  if (buffer.size === 0) return {};
  const drained = Object.fromEntries(buffer);
  buffer.clear();
  return drained;
}

/**
 * Devolve o buffer pro lugar quando o envio falha (rede caiu, 500) — sem
 * isso, uma falha de rede jogaria fora a contagem já drenada. Soma em vez
 * de sobrescrever: entre o drain e a falha, novos cliques podem ter entrado.
 */
export function restoreFeatureUsage(counts: Record<string, number>): void {
  for (const [key, count] of Object.entries(counts)) {
    const feature = key as FeatureKey;
    buffer.set(feature, (buffer.get(feature) ?? 0) + count);
  }
}

export function hasPendingFeatureUsage(): boolean {
  return buffer.size > 0;
}
