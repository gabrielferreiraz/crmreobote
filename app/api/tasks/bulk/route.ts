import { NextResponse } from "next/server";
import type { $Enums, Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { getSharedScope } from "@/lib/share-groups";
import { dealScopeWhere } from "@/lib/deals/split";
import { runWithTenant } from "@/lib/tenant-context";
import { parseBrazilDateTime } from "@/lib/timezone";
import { recordUserChange } from "@/lib/user-activity";
import { normalizePhoneNumber } from "@/lib/phone-normalize";
import { resolvePreferredInstancesByOwner } from "@/lib/whatsapp/send";
import { scriptAccessWhere, validateSteps } from "@/lib/campaigns/scripts";

const MAX_DEALS = 1000;
const VALID_TYPES = new Set<$Enums.TaskType>(["CALL", "WHATSAPP", "EMAIL", "VIDEO_CALL", "VISIT", "PROPOSAL"]);
const TYPE_LABELS: Record<string, string> = {
  CALL: "Ligação",
  WHATSAPP: "WhatsApp",
  EMAIL: "E-mail",
  VIDEO_CALL: "Videochamada",
  VISIT: "Visita",
  PROPOSAL: "Proposta",
};

type Body = {
  action?: "preview" | "create";
  dealIds?: string[];
  type?: string;
  dueAt?: string;
  whatsappCampaign?: { scriptId?: string; message?: string; scheduledAt?: string };
};

export async function POST(request: Request) {
  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  const dealIds = Array.from(new Set(body?.dealIds?.filter((id) => typeof id === "string" && id.length > 0) ?? []));
  if (!body || !body.action || dealIds.length === 0 || dealIds.length > MAX_DEALS) {
    return NextResponse.json({ error: `Selecione entre 1 e ${MAX_DEALS} negócios.` }, { status: 400 });
  }

  return runWithTenant(access.organizationId, async () => {
    const scope = await getSharedScope(access.organizationId, access.userId, access.role, "shareDeals");
    const deals = await prisma.deal.findMany({
      where: { id: { in: dealIds }, organizationId: access.organizationId, ...dealScopeWhere(scope) },
      select: {
        id: true,
        name: true,
        ownerId: true,
        contactId: true,
        contact: { select: { name: true, jobTitle: true, company: true, city: true, whatsapp: true, phone: true } },
        owner: { select: { id: true, name: true } },
      },
    });

    if (deals.length !== dealIds.length) {
      return NextResponse.json({ error: "Um ou mais negócios não estão disponíveis para você." }, { status: 403 });
    }

    if (body.action === "preview") {
      const byId = new Map(deals.map((deal) => [deal.id, deal]));
      return NextResponse.json({
        deals: dealIds.map((id) => byId.get(id)).filter(Boolean).map((deal) => ({
          id: deal!.id,
          title: deal!.name,
          contactName: deal!.contact.name,
          ownerName: deal!.owner.name,
        })),
      });
    }

    if (!body.type || !VALID_TYPES.has(body.type as $Enums.TaskType) || !body.dueAt) {
      return NextResponse.json({ error: "Informe o tipo, a data e o horário." }, { status: 400 });
    }
    const dueAt = parseBrazilDateTime(body.dueAt);
    if (Number.isNaN(dueAt.getTime())) {
      return NextResponse.json({ error: "Data ou horário inválido." }, { status: 400 });
    }
    if (dueAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: "Escolha uma data e um horário futuros." }, { status: 400 });
    }
    const type = body.type as $Enums.TaskType;
    const label = TYPE_LABELS[type];

    let scheduledAt: Date | null = null;
    let messageTemplates: Prisma.InputJsonValue | null = null;
    let campaignRecipients: { contactId: string; dealId: string; instanceId: string }[] = [];
    let primaryInstanceId: string | null = null;
    if (body.whatsappCampaign) {
      if (type !== "WHATSAPP") {
        return NextResponse.json({ error: "A campanha só pode ser criada para tarefas de WhatsApp." }, { status: 400 });
      }
      if (typeof body.whatsappCampaign.scheduledAt !== "string") {
        return NextResponse.json({ error: "Informe quando a campanha deve começar." }, { status: 400 });
      }
      scheduledAt = parseBrazilDateTime(body.whatsappCampaign.scheduledAt);
      if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
        return NextResponse.json({ error: "Escolha uma data e um horário futuros para a campanha." }, { status: 400 });
      }
      if (scheduledAt.getTime() !== dueAt.getTime()) {
        return NextResponse.json({ error: "O início da campanha deve ser o mesmo horário da tarefa." }, { status: 400 });
      }

      if (body.whatsappCampaign.scriptId) {
        const script = await prisma.messageScript.findFirst({
          where: {
            id: body.whatsappCampaign.scriptId,
            organizationId: access.organizationId,
            ...scriptAccessWhere({ userId: access.userId, role: access.role }),
          },
          select: { id: true, steps: true, version: true },
        });
        if (!script) return NextResponse.json({ error: "O script selecionado não está mais disponível." }, { status: 400 });
        const validated = validateSteps(script.steps, access.organizationId);
        if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
        messageTemplates = [{
          steps: validated.steps,
          weight: 1,
          scriptId: script.id,
          scriptVersion: script.version,
        }] as unknown as Prisma.InputJsonValue;
      } else {
        const message = typeof body.whatsappCampaign.message === "string" ? body.whatsappCampaign.message.trim() : "";
        if (!message || message.length > 10000) {
          return NextResponse.json({ error: "Escreva uma mensagem de até 10.000 caracteres." }, { status: 400 });
        }
        messageTemplates = [{
          steps: [{ text: message, delayAfterSec: 0, type: "TEXT" }],
          weight: 1,
        }] as unknown as Prisma.InputJsonValue;
      }
    }

    let campaignId: string | null = null;
    let queued = 0;
    let skippedNoPhone = 0;
    let skippedNoInstance = 0;
    let skippedDuplicateContact = 0;
    if (scheduledAt && messageTemplates) {
      const instanceByOwnerId = await resolvePreferredInstancesByOwner(
        access.organizationId,
        Array.from(new Set(deals.map((deal) => deal.owner.id))),
      );
      const recipients: { contactId: string; dealId: string; instanceId: string }[] = [];
      const seenContactIds = new Set<string>();
      for (const deal of deals) {
        if (seenContactIds.has(deal.contactId)) {
          skippedDuplicateContact += 1;
          continue;
        }
        const phone = normalizePhoneNumber(deal.contact.whatsapp || deal.contact.phone);
        if (!phone) {
          skippedNoPhone += 1;
          continue;
        }
        const instance = instanceByOwnerId.get(deal.owner.id);
        if (!instance) {
          skippedNoInstance += 1;
          continue;
        }
        seenContactIds.add(deal.contactId);
        recipients.push({ contactId: deal.contactId, dealId: deal.id, instanceId: instance.id });
      }
      queued = recipients.length;
      campaignRecipients = recipients;
      primaryInstanceId = recipients[0]?.instanceId ?? null;
    }

    await prisma.$transaction(async (tx) => {
      let activityIds = new Map<string, string>();
      if (type === "VIDEO_CALL" || type === "VISIT") {
        const activities = await tx.activity.createManyAndReturn({
          data: deals.map((deal) => ({
            organizationId: access.organizationId,
            dealId: deal.id,
            contactId: deal.contactId,
            userId: deal.ownerId,
            type,
            body: `${label} com ${deal.contact.name}`,
            meetingOutcome: "PENDING",
          })),
          select: { id: true, dealId: true },
        });
        activityIds = new Map(activities.map((activity) => [activity.dealId!, activity.id]));
      }

      const tasks: Prisma.TaskCreateManyInput[] = deals.map((deal) => ({
        organizationId: access.organizationId,
        dealId: deal.id,
        contactId: deal.contactId,
        ownerId: deal.ownerId,
        type,
        title: `${label} com ${deal.contact.name}`,
        dueAt,
        activityId: activityIds.get(deal.id),
      }));
      await tx.task.createMany({ data: tasks });

      if (scheduledAt && messageTemplates && queued > 0 && primaryInstanceId) {
        const now = new Date();
        const campaign = await tx.campaign.create({
          data: {
            organizationId: access.organizationId,
            name: `Pipeline · ${access.session.user.name ?? "Consultor"} · ${now.toLocaleDateString("pt-BR", { timeZone: "America/Cuiaba" })} ${now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Cuiaba" })}`,
            status: "DRAFT",
            source: "PIPELINE_BULK",
            scheduledAt,
            messageTemplates,
            audienceFilter: { jobTitles: [], tags: [], cities: [] },
            instanceId: primaryInstanceId,
            delayMinSec: 50,
            delayMaxSec: 120,
            allowedWeekdays: [1, 2, 3, 4, 5],
            windowStartHour: 9,
            windowEndHour: 18,
            createdById: access.userId,
          },
        });
        await tx.campaignRecipient.createMany({
          data: campaignRecipients.map((recipient) => ({ campaignId: campaign.id, ...recipient })),
          skipDuplicates: true,
        });
        campaignId = campaign.id;
      }
    });

    recordUserChange(access.organizationId, access.userId).catch((error) =>
      console.error("[user-activity] falha ao registrar alteração", error),
    );
    return NextResponse.json({ created: deals.length, campaignId, queued, skippedNoPhone, skippedNoInstance, skippedDuplicateContact }, { status: 201 });
  });
}
