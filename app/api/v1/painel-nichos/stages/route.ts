import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { requirePanelIntegration } from "@/lib/api/painel-access";
import { apiSuccess } from "@/lib/api/v1-response";
import { rateLimitOrResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requirePanelIntegration(req);
  if (!auth.ok) return auth.response;
  const { access } = auth;
  const limited = rateLimitOrResponse(`apikey:${access.apiKeyId}:panel-stages`, 60, 60_000);
  if (limited) return limited;
  return runWithTenant(access.organizationId, async () => {
    const pipelines = await prisma.pipeline.findMany({
      where: { organizationId: access.organizationId }, orderBy: { order: "asc" },
      select: { id: true, name: true, stages: { orderBy: { order: "asc" }, select: { id: true, name: true } } },
    });
    return apiSuccess({ pipelines });
  });
}
