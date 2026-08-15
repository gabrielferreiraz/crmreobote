import { prisma } from "@/lib/prisma";
import { requireApiKey } from "@/lib/require-api-key";
import { runWithTenant } from "@/lib/tenant-context";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { apiSuccess, apiError } from "@/lib/api/v1-response";
import { findNextAvailableDay } from "@/lib/scheduling/meeting-availability";

export const dynamic = "force-dynamic";

/**
 * Grade de horários pra agendar reunião com um consultor — sempre o
 * primeiro dia útil (a partir de amanhã) com pelo menos 1 slot livre,
 * nunca mais de 1 dia por chamada (cascata, ver
 * lib/scheduling/meeting-availability.ts). Alimenta a última etapa do
 * formulário da landing page externa (Meta Ads) antes de
 * POST /api/v1/appointments. Documentação completa: docs/integracoes-api.md.
 */
export async function GET(req: Request) {
  const access = await requireApiKey(req);
  if (!access.ok) return apiError("Chave de API inválida ou revogada", 401);

  const rateLimited = rateLimitOrResponse(`apikey:${access.apiKeyId}:availability`, 60, 60_000);
  if (rateLimited) return rateLimited;

  const { searchParams } = new URL(req.url);
  const consultorId = searchParams.get("consultorId")?.trim();
  if (!consultorId) return apiError("Parâmetro 'consultorId' é obrigatório", 400);

  return runWithTenant(access.organizationId, async () => {
    const membership = await prisma.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId: access.organizationId, userId: consultorId } },
    });
    if (!membership || !membership.active) {
      return apiError("consultorId inválido para esta organização", 404);
    }

    const result = await findNextAvailableDay(access.organizationId, consultorId);

    return apiSuccess({
      consultorId,
      date: result.date,
      timezone: "America/Campo_Grande",
      slots: result.slots,
      googleCalendarConnected: result.googleCalendarConnected,
    });
  });
}
