import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireApiKey } from "@/lib/require-api-key";
import { runWithTenant } from "@/lib/tenant-context";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { apiSuccess, apiError } from "@/lib/api/v1-response";
import { resolveContactForApiV1 } from "@/lib/api/upsert-contact";
import { sanitizeCell } from "@/lib/csv-sanitize";
import { appointmentInputSchema, firstZodMessage } from "@/lib/api/v1-schemas";
import { brazilDateTimeStringToUTC } from "@/lib/timezone";
import { getValidGoogleAccessToken, createGoogleCalendarEvent } from "@/lib/google-calendar-oauth";
import {
  isMeetingSlotTime,
  isLegitimateBookableDate,
  isSlotStillAvailable,
} from "@/lib/scheduling/meeting-availability";

export const dynamic = "force-dynamic";

/**
 * Reserva um dos slots devolvidos por GET /api/v1/availability. Revalida
 * tudo no servidor — nunca confia no que o cliente mandou como
 * "disponível" (data/hora batendo na grade + ainda livre nesse instante) —
 * e conta com o índice único parcial de
 * 20260814120000_task_meeting_scheduling/migration.sql pra garantir
 * atomicidade real quando dois leads escolhem o mesmo horário ao mesmo
 * tempo (a checagem abaixo fecha a janela na maioria dos casos, mas quem
 * garante mesmo sob corrida é a constraint no banco — ver P2002 abaixo).
 * Documentação completa: docs/integracoes-api.md.
 */
export async function POST(req: Request) {
  const access = await requireApiKey(req);
  if (!access.ok) return apiError("Chave de API inválida ou revogada", 401);

  const rateLimited = rateLimitOrResponse(`apikey:${access.apiKeyId}:appointments`, 30, 60_000);
  if (rateLimited) return rateLimited;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return apiError("Corpo da requisição precisa ser um objeto JSON", 400);
  }

  const parsed = appointmentInputSchema.safeParse(body);
  if (!parsed.success) return apiError(firstZodMessage(parsed.error), 400);

  const { consultorId, date, time, contactId, contact: contactInput, dealId } = parsed.data;

  if (!isMeetingSlotTime(time)) {
    return apiError("time inválido — precisa ser um dos horários da grade (08:30, 10:00, 11:30, 13:00, 14:30)", 400);
  }
  if (!isLegitimateBookableDate(date)) {
    return apiError("date inválida — precisa ser um dia útil a partir de amanhã", 400);
  }

  return runWithTenant(access.organizationId, async () => {
    const membership = await prisma.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId: access.organizationId, userId: consultorId } },
    });
    if (!membership || !membership.active) {
      return apiError("consultorId inválido para esta organização", 404);
    }

    const connection = await prisma.googleCalendarConnection.findUnique({ where: { userId: consultorId } });

    const stillFree = await isSlotStillAvailable(access.organizationId, consultorId, date, time, connection);
    if (!stillFree) return apiError("slot_unavailable", 409);

    const contactResult = await resolveContactForApiV1(access.organizationId, { contactId, contact: contactInput });
    if (!contactResult.ok) return apiError(contactResult.error, 400);
    const contact = contactResult.contact;

    let resolvedDealId: string | undefined;
    if (dealId) {
      const deal = await prisma.deal.findFirst({
        where: { id: dealId, organizationId: access.organizationId },
        select: { id: true },
      });
      if (!deal) return apiError("dealId inválido", 400);
      resolvedDealId = deal.id;
    }

    const dueAt = brazilDateTimeStringToUTC(date, time);

    let task;
    try {
      task = await prisma.task.create({
        data: {
          organizationId: access.organizationId,
          ownerId: consultorId,
          dealId: resolvedDealId,
          contactId: contact.id,
          type: "MEETING",
          title: sanitizeCell(`Reunião com ${contact.name}`),
          dueAt,
        },
      });
    } catch (err) {
      // Índice único parcial (ownerId, dueAt) WHERE type='MEETING' — é a
      // trava real contra dois leads reservando o mesmo horário ao mesmo
      // tempo (ver migration). A checagem isSlotStillAvailable acima cobre
      // o caso comum; isto aqui cobre a corrida de verdade.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return apiError("slot_unavailable", 409);
      }
      throw err;
    }

    let googleCalendarSynced = false;
    if (connection) {
      try {
        const accessToken = await getValidGoogleAccessToken(connection);
        const event = await createGoogleCalendarEvent(accessToken, {
          title: task.title,
          description: resolvedDealId ? `Negócio: ${resolvedDealId}` : undefined,
          start: dueAt,
          end: new Date(dueAt.getTime() + 30 * 60_000),
        });
        await prisma.task.update({ where: { id: task.id }, data: { googleEventId: event.id } });
        googleCalendarSynced = true;
      } catch (err) {
        // A reserva já está gravada (Task criada) — uma falha aqui (token
        // revogado, Google fora do ar) não pode desfazer o agendamento,
        // só sinalizar na resposta e logar pra investigar depois.
        console.error(`[appointments] falha ao sincronizar reunião ${task.id} com o Google Agenda de ${consultorId}`, err);
      }
    }

    return apiSuccess(
      {
        taskId: task.id,
        contactId: contact.id,
        dealId: resolvedDealId ?? null,
        scheduledAt: dueAt.toISOString(),
        googleCalendarSynced,
      },
      201,
    );
  });
}
