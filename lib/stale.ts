export const STALE_DEAL_DAYS = 3;

export function isStale(stageEnteredAt: Date | string) {
  const d = typeof stageEnteredAt === "string" ? new Date(stageEnteredAt) : stageEnteredAt;
  const diffMs = Date.now() - d.getTime();
  return diffMs / (1000 * 60 * 60 * 24) >= STALE_DEAL_DAYS;
}
