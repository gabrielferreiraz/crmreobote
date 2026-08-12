export const STALE_DEAL_DAYS = 3;

export function isStale(stageEnteredAt: Date | string) {
  const d = typeof stageEnteredAt === "string" ? new Date(stageEnteredAt) : stageEnteredAt;
  const diffMs = Date.now() - d.getTime();
  return diffMs / (1000 * 60 * 60 * 24) >= STALE_DEAL_DAYS;
}

/**
 * Teto separado do STALE_DEAL_DAYS(3) acima — aquele alimenta o toggle "Só
 * parados" do Pipeline e a lista "Negócios parados" do Início, os dois já no
 * ar antes do redesign; este é só do card novo "Exige ação" (ver
 * new-design-for-claude/README.md) e do filtro "Parados +14d" do Pipeline.
 * Deliberadamente não reaproveita STALE_DEAL_DAYS — são conceitos parecidos
 * mas com público/gatilho diferentes, mudar um não deve mudar o outro.
 */
export const STALE_DEAL_ALERT_DAYS = 14;

export function daysSinceStageEntered(stageEnteredAt: Date | string): number {
  const d = typeof stageEnteredAt === "string" ? new Date(stageEnteredAt) : stageEnteredAt;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}
