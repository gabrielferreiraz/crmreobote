import { prisma } from "@/lib/prisma";
import { resolveAvatarUrlMap } from "@/lib/r2";
import { scopeWhere, type DealScope } from "@/lib/team-scope";

export type EnrichedDeal = {
  id: string;
  name: string;
  creditType: string | null;
  value: number | null;
  status: "OPEN" | "WON" | "LOST";
  stageId: string;
  stageEnteredAt: Date;
  createdAt: Date;
  closedAt: Date | null;
  stage: { id: string; name: string; color: string | null };
  contact: { id: string; name: string; source: string | null; jobTitle: string | null };
  owner: { id: string; name: string; photoUrl: string | null };
  nextActivity: string | null;
  taskTypes: string[];
  hasUnreadWhatsApp: boolean;
  lossReasonId: string | null;
  lossReason: { id: string; label: string } | null;
};

/**
 * Busca e enriquece negócios (próxima atividade pendente, WhatsApp não lido,
 * foto do responsável) — usado tanto pela renderização inicial da página
 * (Kanban e 1ª página da Lista, ver page.tsx) quanto pelo "carregar mais" da
 * Lista (GET /api/deals) — extraído pra um lugar só pra nunca duplicar essa
 * lógica em dois pontos e eles saírem de sincronia (ex.: Lista carregada via
 * "carregar mais" mostrando negócios sem a bolinha de WhatsApp não lido que
 * a 1ª página tem).
 */
export async function fetchDealsList(params: {
  organizationId: string;
  pipelineId?: string;
  scope: DealScope;
  status?: "OPEN" | "WON" | "LOST";
  q?: string;
  skip?: number;
  take: number;
}): Promise<EnrichedDeal[]> {
  const { organizationId, pipelineId, scope, status, q, skip, take } = params;

  const dealsRaw = await prisma.deal.findMany({
    where: {
      organizationId,
      ...(pipelineId ? { pipelineId } : {}),
      ...scopeWhere(scope),
      ...(status ? { status } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { contact: { name: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    include: { contact: true, owner: true, stage: true, lossReason: true },
    orderBy: { stageEnteredAt: "desc" },
    skip,
    take,
  });

  if (dealsRaw.length === 0) return [];

  const dealIds = dealsRaw.map((d) => d.id);
  const [pendingTasks, unreadMessages, avatarMap] = await Promise.all([
    prisma.task.findMany({
      where: { dealId: { in: dealIds }, completedAt: null },
      orderBy: { dueAt: "asc" },
      select: { dealId: true, title: true, type: true },
    }),
    prisma.whatsAppMessage.findMany({
      where: {
        organizationId,
        direction: "INBOUND",
        read: false,
        thread: { contactId: { in: dealsRaw.map((d) => d.contactId) } },
      },
      select: { thread: { select: { contactId: true } } },
    }),
    resolveAvatarUrlMap(dealsRaw.map((d) => d.owner.image)),
  ]);

  const nextTaskByDeal = new Map<string, string>();
  const taskTypesByDeal = new Map<string, string[]>();
  for (const task of pendingTasks) {
    if (!task.dealId) continue;
    if (!nextTaskByDeal.has(task.dealId)) nextTaskByDeal.set(task.dealId, task.title);
    const types = taskTypesByDeal.get(task.dealId) ?? [];
    if (!types.includes(task.type)) types.push(task.type);
    taskTypesByDeal.set(task.dealId, types);
  }

  const unreadContactIds = new Set(
    unreadMessages.map((m) => m.thread.contactId).filter((id): id is string => !!id),
  );

  return dealsRaw.map((deal) => ({
    id: deal.id,
    name: deal.name,
    creditType: deal.creditType,
    value: deal.value ? Number(deal.value) : null,
    status: deal.status,
    stageId: deal.stageId,
    stageEnteredAt: deal.stageEnteredAt,
    createdAt: deal.createdAt,
    closedAt: deal.closedAt,
    stage: { id: deal.stage.id, name: deal.stage.name, color: deal.stage.color },
    contact: { id: deal.contact.id, name: deal.contact.name, source: deal.contact.source, jobTitle: deal.contact.jobTitle },
    owner: {
      id: deal.owner.id,
      name: deal.owner.name,
      photoUrl: deal.owner.image ? (avatarMap.get(deal.owner.image) ?? null) : null,
    },
    nextActivity: nextTaskByDeal.get(deal.id) ?? null,
    taskTypes: taskTypesByDeal.get(deal.id) ?? [],
    hasUnreadWhatsApp: unreadContactIds.has(deal.contactId),
    lossReasonId: deal.lossReasonId,
    lossReason: deal.lossReason ? { id: deal.lossReason.id, label: deal.lossReason.label } : null,
  }));
}
