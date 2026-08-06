import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveAvatarUrlMap } from "@/lib/r2";
import { getContactsWithUnreadWhatsApp, getProcessesWithUnreadNotes } from "@/lib/processes/whatsapp-signals";

export type EnrichedProcess = {
  id: string;
  pipelineId: string;
  pipelineName: string;
  categoryId: string;
  categoryName: string;
  stageId: string;
  stage: { id: string; name: string; color: string | null; slaBusinessDays: number | null };
  documentStatus: "NOT_REQUESTED" | "PENDING_DELIVERY" | "DELIVERED";
  quotaNumber: string | null;
  groupNumber: string | null;
  stageEnteredAt: Date;
  contact: { id: string; name: string; phone: string | null; whatsapp: string | null };
  owner: { id: string; name: string; photoUrl: string | null };
  deal: { id: string; name: string; value: number | null };
  openRequestCount: number;
  hasUnreadWhatsApp: boolean;
  hasUnreadNote: boolean;
};

export type ProcessFilterParams = {
  organizationId: string;
  /** Não-admin só enxerga os próprios (ver lib/processes/access.ts). */
  ownerId?: string;
  categoryId?: string;
  pipelineId?: string;
  stageId?: string;
  documentStatus?: "NOT_REQUESTED" | "PENDING_DELIVERY" | "DELIVERED";
  /** Nome do cliente, do negócio, ou nº de cota/grupo. */
  q?: string;
};

/** Mesmo motivo de buildDealsWhere: lista e contagem nunca podem sair de sincronia. */
export function buildProcessWhere(params: ProcessFilterParams): Prisma.ProcessWhereInput {
  const { organizationId, ownerId, categoryId, pipelineId, stageId, documentStatus, q } = params;

  return {
    organizationId,
    ...(ownerId ? { ownerId } : {}),
    ...(pipelineId ? { pipelineId } : categoryId ? { pipeline: { categoryId } } : {}),
    ...(stageId ? { stageId } : {}),
    ...(documentStatus ? { documentStatus } : {}),
    ...(q
      ? {
          OR: [
            { contact: { name: { contains: q, mode: "insensitive" } } },
            { deal: { name: { contains: q, mode: "insensitive" } } },
            { quotaNumber: { contains: q, mode: "insensitive" } },
            { groupNumber: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

export async function countProcesses(params: ProcessFilterParams): Promise<number> {
  return prisma.process.count({ where: buildProcessWhere(params) });
}

/** Mesma ideia de countDealsByStage (lib/deals/list-query.ts) — total real de
 * cada etapa pro Kanban, sem precisar carregar todo mundo pra memória só pra
 * contar (ver process-kanban-board.tsx, que busca só uma página por vez). */
export async function countProcessesByStage(params: ProcessFilterParams): Promise<Record<string, number>> {
  const groups = await prisma.process.groupBy({
    by: ["stageId"],
    where: buildProcessWhere(params),
    _count: { _all: true },
  });
  return Object.fromEntries(groups.map((g) => [g.stageId, g._count._all]));
}

export async function fetchProcessList(
  params: ProcessFilterParams & { skip?: number; take: number },
): Promise<EnrichedProcess[]> {
  const { organizationId, skip, take } = params;

  const rows = await prisma.process.findMany({
    where: buildProcessWhere(params),
    select: {
      id: true,
      pipelineId: true,
      stageId: true,
      documentStatus: true,
      quotaNumber: true,
      groupNumber: true,
      stageEnteredAt: true,
      contact: { select: { id: true, name: true, phone: true, whatsapp: true } },
      owner: { select: { id: true, name: true, image: true } },
      stage: { select: { id: true, name: true, color: true, slaBusinessDays: true } },
      pipeline: { select: { id: true, name: true, categoryId: true, category: { select: { name: true } } } },
      deal: { select: { id: true, name: true, value: true } },
      _count: { select: { requests: { where: { resolvedAt: null } } } },
    },
    orderBy: { stageEnteredAt: "desc" },
    skip,
    take,
  });

  if (rows.length === 0) return [];

  const [avatarMap, unreadContactIds, unreadNoteProcessIds] = await Promise.all([
    resolveAvatarUrlMap(rows.map((p) => p.owner.image)),
    getContactsWithUnreadWhatsApp(organizationId, rows.map((p) => p.contact.id)),
    getProcessesWithUnreadNotes(rows.map((p) => p.id)),
  ]);

  return rows.map((p) => ({
    id: p.id,
    pipelineId: p.pipelineId,
    pipelineName: p.pipeline.name,
    categoryId: p.pipeline.categoryId,
    categoryName: p.pipeline.category.name,
    stageId: p.stageId,
    stage: p.stage,
    documentStatus: p.documentStatus,
    quotaNumber: p.quotaNumber,
    groupNumber: p.groupNumber,
    stageEnteredAt: p.stageEnteredAt,
    contact: p.contact,
    owner: {
      id: p.owner.id,
      name: p.owner.name,
      photoUrl: p.owner.image ? (avatarMap.get(p.owner.image) ?? null) : null,
    },
    deal: { id: p.deal.id, name: p.deal.name, value: p.deal.value != null ? Number(p.deal.value) : null },
    openRequestCount: p._count.requests,
    hasUnreadWhatsApp: unreadContactIds.has(p.contact.id),
    hasUnreadNote: unreadNoteProcessIds.has(p.id),
  }));
}
