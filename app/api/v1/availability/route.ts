import { prisma } from "@/lib/prisma";
import { requireApiKey } from "@/lib/require-api-key";
import { runWithTenant } from "@/lib/tenant-context";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { apiSuccess, apiError } from "@/lib/api/v1-response";
import { findNextAvailableDay, getSlotsForDay, isLegitimateBookableDate } from "@/lib/scheduling/meeting-availability";

export const dynamic = "force-dynamic";

/**
 * Grade de horários pra agendar reunião com um consultor. Sem `?date=`,
 * devolve o primeiro dia útil (a partir de hoje) com pelo menos 1 slot
 * livre, nunca mais de 1 dia por chamada (cascata, ver
 * lib/scheduling/meeting-availability.ts). Com `?date=YYYY-MM-DD`, devolve
 * os slots exatamente desse dia (mesmo formato de resposta) — pra quem
 * quiser mostrar mais de um dia de uma vez (ex.: um calendário na landing
 * page com hoje + o próximo dia útil já coloridos) em vez de confiar
 * cegamente na escolha em cascata. Alimenta a última etapa do formulário da
 * landing page externa (Meta Ads) antes de POST /api/v1/appointments.
 * Documentação completa: docs/integracoes-api.md.
 */
export async function GET(req: Request) {
  const access = await requireApiKey(req);
  if (!access.ok) return apiError("Chave de API inválida ou revogada", 401);

  const rateLimited = rateLimitOrResponse(`apikey:${access.apiKeyId}:availability`, 60, 60_000);
  if (rateLimited) return rateLimited;

  const { searchParams } = new URL(req.url);
  const consultorId = searchParams.get("consultorId")?.trim();
  if (!consultorId) return apiError("Parâmetro 'consultorId' é obrigatório", 400);

  const dateParam = searchParams.get("date")?.trim();
  if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return apiError("Parâmetro 'date' precisa estar no formato YYYY-MM-DD", 400);
  }

  return runWithTenant(access.organizationId, async () => {
    const membership = await prisma.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId: access.organizationId, userId: consultorId } },
    });
    if (!membership || !membership.active) {
      return apiError("consultorId inválido para esta organização", 404);
    }

    if (dateParam) {
      if (!isLegitimateBookableDate(dateParam)) {
        return apiError("date inválida — precisa ser um dia útil a partir de hoje", 400);
      }
      const connection = await prisma.googleCalendarConnection.findUnique({ where: { userId: consultorId } });
      const slots = await getSlotsForDay(access.organizationId, consultorId, dateParam, connection);
      return apiSuccess({
        consultorId,
        date: dateParam,
        timezone: "America/Campo_Grande",
        slots,
        googleCalendarConnected: !!connection,
      });
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
