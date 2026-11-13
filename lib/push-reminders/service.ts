import type { $Enums } from "@/app/generated/prisma/client";
import { matchesBusinessHours } from "@/lib/automations/message-trigger";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { runWithTenant } from "@/lib/tenant-context";
import { pushReminderEventKey, pushReminderScopeKey } from "./keys";

const REPEAT_INTERVAL_MS = 2 * 60 * 60 * 1000;
const DEFAULT_ADMIN_BUSINESS_HOURS = {
  start: "08:00",
  end: "18:00",
  days: [1, 2, 3, 4, 5],
};

type ReminderInput = {
  organizationId: string;
  userId: string;
  kind: $Enums.PushReminderKind;
  eventKey: string;
  scopeKey: string;
  title: string;
  body?: string | null;
  url: string;
};

type DeliveryResult = { claimed: boolean; sent: number; total: number };

async function upsertReminder(input: ReminderInput) {
  return runWithTenant(input.organizationId, () =>
    prisma.pushReminder.upsert({
      where: {
        organizationId_userId_eventKey: {
          organizationId: input.organizationId,
          userId: input.userId,
          eventKey: input.eventKey,
        },
      },
      create: {
        organizationId: input.organizationId,
        userId: input.userId,
        kind: input.kind,
        eventKey: input.eventKey,
        scopeKey: input.scopeKey,
        title: input.title,
        body: input.body ?? null,
        url: input.url,
        nextSendAt: new Date(),
      },
      // Reprocessar o mesmo evento atualiza o texto, mas nunca desfaz leitura
      // ou resolução já registrada.
      update: {
        scopeKey: input.scopeKey,
        title: input.title,
        body: input.body ?? null,
        url: input.url,
      },
      select: { id: true },
    }),
  );
}

/**
 * Reserva a entrega antes de chamar Web Push. O update condicional torna dois
 * ticks simultâneos inofensivos: só um consegue mover `nextSendAt`.
 */
async function deliverReminder(
  organizationId: string,
  reminderId: string,
  options: { allowOutsideBusinessHours?: boolean; businessHoursAlreadyChecked?: boolean } = {},
): Promise<DeliveryResult> {
  const now = new Date();
  if (!options.allowOutsideBusinessHours && !options.businessHoursAlreadyChecked) {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { businessHours: true },
    });
    const insideBusinessHours = matchesBusinessHours(
      organization?.businessHours ?? DEFAULT_ADMIN_BUSINESS_HOURS,
      "INSIDE_BUSINESS_HOURS",
    );
    if (!insideBusinessHours) return { claimed: false, sent: 0, total: 0 };
  }

  const candidate = await runWithTenant(organizationId, () =>
    prisma.pushReminder.findFirst({
      where: {
        id: reminderId,
        organizationId,
        openedAt: null,
        resolvedAt: null,
        nextSendAt: { lte: now },
      },
      select: {
        id: true,
        userId: true,
        title: true,
        body: true,
        url: true,
        nextSendAt: true,
        firstSentAt: true,
        attemptCount: true,
      },
    }),
  );
  if (!candidate?.nextSendAt) return { claimed: false, sent: 0, total: 0 };

  const claimed = await runWithTenant(organizationId, () =>
    prisma.pushReminder.updateMany({
      where: {
        id: candidate.id,
        organizationId,
        openedAt: null,
        resolvedAt: null,
        nextSendAt: candidate.nextSendAt,
      },
      data: {
        firstSentAt: candidate.firstSentAt ?? now,
        lastSentAt: now,
        nextSendAt: new Date(now.getTime() + REPEAT_INTERVAL_MS),
        attemptCount: { increment: 1 },
      },
    }),
  );
  if (claimed.count === 0) return { claimed: false, sent: 0, total: 0 };

  const repeated = candidate.attemptCount > 0;
  const delivery = await sendPushToUser(candidate.userId, {
    title: repeated ? `Lembrete: ${candidate.title}` : candidate.title,
    body: candidate.body ?? undefined,
    url: candidate.url,
    reminderId: candidate.id,
    tag: `crm-reminder-${candidate.id}`,
    renotify: repeated,
  });
  return { claimed: true, ...delivery };
}

/** Persiste o evento antes do primeiro push e envia imediatamente, inclusive fora do expediente. */
export async function createAdministrativePushReminder(input: ReminderInput): Promise<DeliveryResult> {
  const reminder = await upsertReminder(input);
  return deliverReminder(input.organizationId, reminder.id, { allowOutsideBusinessHours: true });
}

export async function acknowledgePushReminder(params: {
  organizationId: string;
  userId: string;
  reminderId?: string;
  scopeKey?: string;
}): Promise<number> {
  if (!params.reminderId && !params.scopeKey) return 0;
  const now = new Date();
  const result = await runWithTenant(params.organizationId, () =>
    prisma.pushReminder.updateMany({
      where: {
        organizationId: params.organizationId,
        userId: params.userId,
        openedAt: null,
        resolvedAt: null,
        ...(params.reminderId ? { id: params.reminderId } : { scopeKey: params.scopeKey }),
      },
      data: { openedAt: now, nextSendAt: null },
    }),
  );
  return result.count;
}

export async function resolvePushReminderEvent(organizationId: string, eventKey: string): Promise<number> {
  const result = await runWithTenant(organizationId, () =>
    prisma.pushReminder.updateMany({
      where: { organizationId, eventKey, resolvedAt: null },
      data: { resolvedAt: new Date(), nextSendAt: null },
    }),
  );
  return result.count;
}

/**
 * Cria registros para pendências antigas que já existiam antes desta feature.
 * A inserção ignora chaves existentes e não reabre nada já lido ou resolvido.
 */
async function materializeExistingAdministrativePending(
  organizationId: string,
  administrativeUserIds: string[],
): Promise<number> {
  const [quotaTasks, processRequests] = await Promise.all([
    prisma.task.findMany({
      where: {
        organizationId,
        completedAt: null,
        dealId: { not: null },
        title: { startsWith: "Cadastrar cota:" },
      },
      select: { ownerId: true, dealId: true, title: true },
    }),
    prisma.processRequest.findMany({
      where: { organizationId, targetUserId: null, resolvedAt: null },
      select: {
        id: true,
        processId: true,
        requestedBy: { select: { name: true } },
        process: {
          select: { clientName: true, contact: { select: { name: true } } },
        },
      },
    }),
  ]);

  const activeAdminIds = new Set(administrativeUserIds);
  const inputs: ReminderInput[] = [];
  for (const task of quotaTasks) {
    if (!task.dealId || !activeAdminIds.has(task.ownerId)) continue;
    const clientName = task.title.replace(/^Cadastrar cota:\s*/i, "").trim() || "Cliente";
    inputs.push({
      organizationId,
      userId: task.ownerId,
      kind: "ADMIN_QUOTA_REGISTRATION",
      eventKey: pushReminderEventKey.quotaRegistration(task.dealId),
      scopeKey: pushReminderScopeKey.deal(task.dealId),
      title: "Cota aguardando cadastro",
      body: `${clientName} · abra Cadastros para concluir.`,
      url: `/cadastros/${task.dealId}`,
    });
  }

  for (const request of processRequests) {
    const contactName = request.process.contact?.name ?? request.process.clientName ?? "Cliente";
    for (const userId of activeAdminIds) {
      inputs.push({
        organizationId,
        userId,
        kind: "ADMIN_PROCESS_REQUEST",
        eventKey: pushReminderEventKey.processRequest(request.id),
        scopeKey: pushReminderScopeKey.process(request.processId),
        title: "Solicitação de consultor",
        body: `${request.requestedBy.name} pediu algo sobre ${contactName}.`,
        url: `/processos/${request.processId}`,
      });
    }
  }

  if (inputs.length === 0) return 0;
  const created = await prisma.pushReminder.createMany({
    data: inputs.map((input) => ({
      organizationId: input.organizationId,
      userId: input.userId,
      kind: input.kind,
      eventKey: input.eventKey,
      scopeKey: input.scopeKey,
      title: input.title,
      body: input.body ?? null,
      url: input.url,
      nextSendAt: new Date(),
    })),
    skipDuplicates: true,
  });
  return created.count;
}

export async function sendDueAdministrativePushReminders(): Promise<{
  checked: number;
  claimed: number;
  sent: number;
  materialized: number;
  outsideBusinessHours: number;
}> {
  const organizations = await prisma.organization.findMany({
    select: { id: true, businessHours: true },
  });
  let checked = 0;
  let claimed = 0;
  let sent = 0;
  let materialized = 0;
  let outsideBusinessHours = 0;
  const materializeLegacyPending = new Date().getMinutes() < 3;

  for (const organization of organizations) {
    const insideBusinessHours = matchesBusinessHours(
      organization.businessHours ?? DEFAULT_ADMIN_BUSINESS_HOURS,
      "INSIDE_BUSINESS_HOURS",
    );
    if (!insideBusinessHours) {
      outsideBusinessHours += 1;
      continue;
    }

    const dueIds = await runWithTenant(organization.id, async () => {
      const activeAdministrativeUsers = await prisma.organizationUser.findMany({
        where: {
          organizationId: organization.id,
          active: true,
          OR: [
            { role: "OWNER" },
            { area: "ADMINISTRATIVO" },
            { area: "POS_CONTEMPLACAO" },
            { canManageProcesses: true },
          ],
        },
        select: { userId: true },
      });
      const activeUserIds = activeAdministrativeUsers.map((member) => member.userId);
      if (activeUserIds.length === 0) return [];
      if (materializeLegacyPending) {
        materialized += await materializeExistingAdministrativePending(
          organization.id,
          activeUserIds,
        );
      }
      const due = await prisma.pushReminder.findMany({
        where: {
          organizationId: organization.id,
          userId: { in: activeUserIds },
          openedAt: null,
          resolvedAt: null,
          nextSendAt: { lte: new Date() },
        },
        orderBy: { nextSendAt: "asc" },
        take: 200,
        select: { id: true },
      });
      return due.map((row) => row.id);
    });
    checked += dueIds.length;

    // O pool do Prisma tem 20 conexões; oito entregas paralelas dão vazão sem
    // deixar um lote grande monopolizar o cron compartilhado.
    for (let index = 0; index < dueIds.length; index += 8) {
      const batch = dueIds.slice(index, index + 8);
      const results = await Promise.all(
        batch.map(async (reminderId) => {
          try {
            return await deliverReminder(organization.id, reminderId, {
              businessHoursAlreadyChecked: true,
            });
          } catch (error) {
            console.error("[push-reminders] falha ao repetir lembrete", {
              organizationId: organization.id,
              reminderId,
              error,
            });
            return { claimed: false, sent: 0, total: 0 } satisfies DeliveryResult;
          }
        }),
      );
      for (const result of results) {
        if (result.claimed) claimed += 1;
        sent += result.sent;
      }
    }
  }

  return { checked, claimed, sent, materialized, outsideBusinessHours };
}
