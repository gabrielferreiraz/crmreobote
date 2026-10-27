import { prisma } from "@/lib/prisma";
import { enqueueServopaSync } from "@/lib/servopa-tables/queue";
import { scheduleServopaWithDependencies } from "@/lib/servopa-tables/scheduler-contract";
import { runWithTenant } from "@/lib/tenant-context";

export async function scheduleServopaMonthlySync(now = new Date()) {
  return scheduleServopaWithDependencies(now, {
    async listOrganizationIds() {
      const organizations = await prisma.organization.findMany({ select: { id: true } });
      return organizations.map((organization) => organization.id);
    },
    findCoveredRun(organizationId, window) {
      return runWithTenant(organizationId, async () => {
        const run = await prisma.servopaSyncRun.findFirst({
          where: {
            organizationId,
            trigger: { in: ["SCHEDULED", "MANUAL"] },
            createdAt: { gte: window.dueAt, lt: window.monthEndsAt },
          },
          select: { id: true },
        });
        return Boolean(run);
      });
    },
    async enqueue(organizationId) {
      const result = await enqueueServopaSync({ organizationId, trigger: "SCHEDULED" });
      return { created: result.created };
    },
  });
}
