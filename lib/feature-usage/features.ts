/**
 * Lista FECHADA das funcionalidades medidas — ver FeatureUsageDaily no
 * schema. Importável no cliente (nenhum import de prisma aqui de propósito,
 * mesmo motivo de lib/notification-settings-constants.ts: importar algo que
 * puxa prisma arrasta `pg` pro bundle do navegador).
 *
 * Fechada por dois motivos:
 * 1. Segurança: o cliente manda a chave, então o servidor descarta o que
 *    não estiver aqui (ver recordFeatureUsage) — senão um cliente adulterado
 *    encheria a tabela com chaves inventadas.
 * 2. Interpretação: medir "todo botão" daria centenas de chaves que ninguém
 *    lê. Aqui só entram ações que respondem uma pergunta de produto de
 *    verdade — "usam a ação em massa?", "abrem Relatórios?".
 *
 * Como medir uma ação nova: acrescente a chave aqui com um rótulo em
 * português e chame `trackUse("a.chave")` no lugar onde a ação ACONTECE
 * (não no render) — ver lib/feature-usage/track.ts.
 *
 * Convenção da chave: "tela.area.acao", minúsculo, sem acento — o rótulo é
 * que aparece na tela, a chave é estável pra sempre (renomear chave perde o
 * histórico dela).
 */
export const FEATURE_LABELS = {
  // Pipeline — o coração do CRM, e onde acabamos de mexer bastante
  "pipeline.selecao.abrir": "Pipeline · abrir modo seleção",
  "pipeline.selecao.etapa-inteira": "Pipeline · selecionar etapa inteira",
  "pipeline.massa.etapa": "Pipeline · massa: trocar etapa",
  "pipeline.massa.funil": "Pipeline · massa: trocar funil",
  "pipeline.massa.responsavel": "Pipeline · massa: trocar responsável",
  "pipeline.massa.origem": "Pipeline · massa: trocar origem",
  "pipeline.massa.ganho": "Pipeline · massa: marcar ganho",
  "pipeline.massa.perdido": "Pipeline · massa: marcar perdido",
  "pipeline.massa.mensagem": "Pipeline · massa: enviar mensagem",
  "pipeline.card.arrastar": "Pipeline · arrastar card entre etapas",
  "pipeline.visao.lista": "Pipeline · trocar pra visão Lista",
  "pipeline.negocio.novo": "Pipeline · criar negócio",

  // Busca geral (Cmd+K) — dá pra saber se vale investir nela
  "busca.abrir": "Busca geral (Cmd+K)",
} as const;

export type FeatureKey = keyof typeof FEATURE_LABELS;

export const FEATURE_KEYS = Object.keys(FEATURE_LABELS) as FeatureKey[];

export function isFeatureKey(value: unknown): value is FeatureKey {
  return typeof value === "string" && value in FEATURE_LABELS;
}

/** Rótulo pra exibição; cai na própria chave se alguma linha antiga ficou no banco com uma chave já removida daqui. */
export function featureLabel(key: string): string {
  return isFeatureKey(key) ? FEATURE_LABELS[key] : key;
}
