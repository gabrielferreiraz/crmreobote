import { BRAZIL_UTC_OFFSET_HOURS, getBrazilParts } from "../timezone.ts";

export type ServopaScheduleWindow = {
  dueAt: Date;
  monthEndsAt: Date;
  competence: string;
};

/** Dia 1, a partir de 08:15 no fuso operacional (UTC-4). */
export function getServopaScheduleWindow(now: Date): ServopaScheduleWindow | null {
  const { year, month, day, hour, minute } = getBrazilParts(now);
  if (day !== 1 || hour < 8 || (hour === 8 && minute < 15)) return null;
  return {
    dueAt: new Date(Date.UTC(year, month, 1, 8 + BRAZIL_UTC_OFFSET_HOURS, 15, 0, 0)),
    monthEndsAt: new Date(Date.UTC(year, month + 1, 1, BRAZIL_UTC_OFFSET_HOURS, 0, 0, 0)),
    competence: `${year}-${String(month + 1).padStart(2, "0")}`,
  };
}

export type ServopaSchedulerDependencies = {
  listOrganizationIds: () => Promise<string[]>;
  findCoveredRun: (organizationId: string, window: ServopaScheduleWindow) => Promise<boolean>;
  enqueue: (organizationId: string) => Promise<{ created: boolean }>;
};

export async function scheduleServopaWithDependencies(now: Date, dependencies: ServopaSchedulerDependencies) {
  const window = getServopaScheduleWindow(now);
  if (!window) return { due: false, competence: null, organizations: 0, enqueued: 0, alreadyCovered: 0 };

  const organizationIds = await dependencies.listOrganizationIds();
  let enqueued = 0;
  let alreadyCovered = 0;
  for (const organizationId of organizationIds) {
    if (await dependencies.findCoveredRun(organizationId, window)) {
      alreadyCovered++;
      continue;
    }
    const result = await dependencies.enqueue(organizationId);
    if (result.created) enqueued++;
    else alreadyCovered++;
  }
  return { due: true, competence: window.competence, organizations: organizationIds.length, enqueued, alreadyCovered };
}
