/**
 * Prazo (SLA) por etapa de processo, em dias úteis — ver ProcessStage.slaBusinessDays
 * (prisma/schema.prisma) e a planilha de pendências de contemplação que o
 * administrativo mantinha à parte, cujo núcleo é exatamente isto: prazo por
 * etapa + atraso calculado. Conta só segunda–sexta, sem calendário de
 * feriados — mesma simplificação que a maioria das fórmulas de "dias úteis"
 * de planilha já assume; dá pra evoluir depois se fizer falta de verdade.
 */

/** Dias úteis estritamente ENTRE from e to (from não conta, to conta se for um dia útil). `to <= from` retorna 0. */
export function countBusinessDays(from: Date, to: Date): number {
  if (to <= from) return 0;
  const cursor = new Date(from);
  cursor.setUTCHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setUTCHours(0, 0, 0, 0);
  let count = 0;
  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

export type StageSlaStatus = {
  daysElapsed: number;
  slaBusinessDays: number;
  daysOverdue: number;
  overdue: boolean;
};

/**
 * `null` quando a etapa não tem prazo configurado — nada pra calcular/mostrar
 * (ver ProcessCardContent/process-detail.tsx: o badge de atraso só aparece
 * quando isto não é null E overdue é true, mesmo padrão de badge
 * só-quando-é-problema já usado no resto do app).
 */
export function getStageSlaStatus(
  stage: { slaBusinessDays: number | null },
  stageEnteredAt: Date,
  now: Date = new Date(),
): StageSlaStatus | null {
  if (stage.slaBusinessDays == null) return null;
  const daysElapsed = countBusinessDays(stageEnteredAt, now);
  const daysOverdue = daysElapsed - stage.slaBusinessDays;
  return { daysElapsed, slaBusinessDays: stage.slaBusinessDays, daysOverdue, overdue: daysOverdue > 0 };
}
