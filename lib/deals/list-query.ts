import { Prisma } from "@/app/generated/prisma/client";
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
  lostReason: string | null;
};

export type DealsFilterParams = {
  organizationId: string;
  pipelineId?: string;
  scope: DealScope;
  status?: "OPEN" | "WON" | "LOST";
  q?: string;
  /** Já resolvido pelo chamador (ver deals-list.tsx) — a interseção entre "responsável X" e "status ativo/inativo" quando os dois filtros estão ativos ao mesmo tempo é calculada ANTES de chegar aqui, então este parâmetro é sempre um simples "está numa dessas ids" ou nada. */
  ownerIds?: string[];
  stageId?: string;
  lossReasonId?: string;
  jobTitle?: string;
  source?: string;
  createdFrom?: Date;
  createdTo?: Date;
  closedFrom?: Date;
  closedTo?: Date;
};

/**
 * Monta o `where` uma vez só, reaproveitado tanto pela busca da página quanto
 * pela contagem (`countDeals`) — precisam SEMPRE bater, senão a paginação
 * mostra "página 3 de 5" e a página 3 vem vazia porque a contagem usou um
 * filtro diferente do da busca.
 */
export function buildDealsWhere(params: DealsFilterParams): Prisma.DealWhereInput {
  const { organizationId, pipelineId, scope, status, q, ownerIds, stageId, lossReasonId, jobTitle, source, createdFrom, createdTo, closedFrom, closedTo } = params;

  const where: Prisma.DealWhereInput = {
    organizationId,
    ...(pipelineId ? { pipelineId } : {}),
    ...scopeWhere(scope),
    ...(status ? { status } : {}),
    ...(ownerIds && ownerIds.length > 0 ? { ownerId: { in: ownerIds } } : {}),
    ...(stageId ? { stageId } : {}),
    ...(lossReasonId ? { lossReasonId } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { contact: { name: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  if (jobTitle || source) {
    where.contact = {
      ...(jobTitle ? { jobTitle } : {}),
      ...(source ? { source } : {}),
    };
  }

  if (createdFrom || createdTo) {
    where.createdAt = {
      ...(createdFrom ? { gte: createdFrom } : {}),
      ...(createdTo ? { lte: createdTo } : {}),
    };
  }

  if (closedFrom || closedTo) {
    where.closedAt = {
      not: null,
      ...(closedFrom ? { gte: closedFrom } : {}),
      ...(closedTo ? { lte: closedTo } : {}),
    };
  }

  return where;
}

export async function countDeals(params: DealsFilterParams): Promise<number> {
  return prisma.deal.count({ where: buildDealsWhere(params) });
}

/**
 * Somas (Ganhos/Perdidos/Total) sobre TODO o conjunto filtrado, não só a
 * página atual — precisa ser uma consulta à parte porque com paginação de
 * verdade a página só tem no máximo 200 linhas, e um total de dinheiro
 * mostrado pro usuário não pode refletir só isso.
 */
export async function aggregateDealValues(params: DealsFilterParams): Promise<{ wonSum: number; lostSum: number; totalSum: number }> {
  const groups = await prisma.deal.groupBy({
    by: ["status"],
    where: buildDealsWhere(params),
    _sum: { value: true },
  });
  let wonSum = 0;
  let lostSum = 0;
  let totalSum = 0;
  for (const g of groups) {
    const sum = g._sum.value ? Number(g._sum.value) : 0;
    totalSum += sum;
    if (g.status === "WON") wonSum = sum;
    if (g.status === "LOST") lostSum = sum;
  }
  return { wonSum, lostSum, totalSum };
}

/**
 * Busca e enriquece negócios (próxima atividade pendente, WhatsApp não lido,
 * foto do responsável) — usado tanto pela renderização inicial da página
 * (Kanban e 1ª página da Lista, ver page.tsx) quanto pela paginação da Lista
 * (GET /api/deals) — extraído pra um lugar só pra nunca duplicar essa lógica
 * em dois pontos e eles saírem de sincronia.
 */
export async function fetchDealsList(params: DealsFilterParams & { skip?: number; take: number }): Promise<EnrichedDeal[]> {
  const { organizationId, skip, take } = params;

  const dealsRaw = await prisma.deal.findMany({
    where: buildDealsWhere(params),
    // `select` em vez de `include: { owner: true, contact: true, ... }` —
    // owner é um User inteiro (senha com hash, e-mail etc.) e contact tem
    // campos potencialmente grandes (customFields JSON, endereço completo)
    // que o `.map()` abaixo nunca usa; numa lista de até 200+5000 linhas
    // (Lista + Kanban) isso é bytes reais trafegados do Postgres à toa.
    select: {
      id: true,
      name: true,
      creditType: true,
      value: true,
      status: true,
      stageId: true,
      stageEnteredAt: true,
      createdAt: true,
      closedAt: true,
      contactId: true,
      lossReasonId: true,
      lostReason: true,
      contact: { select: { id: true, name: true, source: true, jobTitle: true } },
      owner: { select: { id: true, name: true, image: true } },
      stage: { select: { id: true, name: true, color: true } },
      lossReason: { select: { id: true, label: true } },
    },
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
    lostReason: deal.lostReason,
  }));
}
