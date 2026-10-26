import { NextResponse } from "next/server";
import type { $Enums, Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { getSharedScope } from "@/lib/share-groups";
import { dealScopeWhere } from "@/lib/deals/split";
import { runWithTenant } from "@/lib/tenant-context";
import { parseBrazilDateTime } from "@/lib/timezone";
import { recordUserChange } from "@/lib/user-activity";

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

type Body = { action?: "preview" | "create"; dealIds?: string[]; type?: string; dueAt?: string };

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
        contact: { select: { name: true } },
        owner: { select: { name: true } },
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
    });

    recordUserChange(access.organizationId, access.userId).catch((error) =>
      console.error("[user-activity] falha ao registrar alteração", error),
    );
    return NextResponse.json({ created: deals.length }, { status: 201 });
  });
}
