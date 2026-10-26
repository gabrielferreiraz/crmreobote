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
  /** null em processo avulso — contemplado que não é contato deste CRM (ver
   * contactId/clientName no model Process). Para exibir o nome use
   * `displayName` abaixo, que já resolve os dois casos. */
  contact: { id: string; name: string; phone: string | null; whatsapp: string | null } | null;
  /** Nome a estampar na tela, venha do contato ou do rótulo avulso. */
  displayName: string;
  /** Valor a estampar/somar: do negócio quando existe, senão o próprio do
   * processo. null quando nenhum dos dois foi preenchido. */
  displayValue: number | null;
  owner: { id: string; name: string; photoUrl: string | null };
  deal: { id: string; name: string; value: number | null } | null;
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
            // Processo avulso não tem contato, então o nome dele só é
            // encontrável por esta coluna.
            { clientName: { contains: q, mode: "insensitive" } },
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
      clientName: true,
      value: true,
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
    // Só processos COM contato entram aqui: conversa de WhatsApp é indexada
    // por contato, então processo avulso nunca tem mensagem pra marcar.
    getContactsWithUnreadWhatsApp(
      organizationId,
      rows.map((p) => p.contact?.id).filter((id): id is string => !!id),
    ),
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
    // Resolvido uma vez aqui pra tela não repetir o mesmo `?? clientName` em
    // cada lugar que estampa o nome (card do Kanban, lista, mobile).
    displayName: p.contact?.name ?? p.clientName ?? "Sem nome",
    owner: {
      id: p.owner.id,
      name: p.owner.name,
      photoUrl: p.owner.image ? (avatarMap.get(p.owner.image) ?? null) : null,
    },
    // null quando o processo não nasceu de um negócio deste CRM (cliente já
    // contemplado cuja venda nunca foi registrada aqui) — ver dealId no model
    // Process. Quem exibe decide o que mostrar no lugar do nome/valor.
    deal: p.deal ? { id: p.deal.id, name: p.deal.name, value: p.deal.value != null ? Number(p.deal.value) : null } : null,
    // Valor a exibir/somar: o do negócio manda quando existe; sem negócio,
    // cai no valor próprio do processo (ver value no model Process). Resolvido
    // aqui pra Kanban, lista e mobile não repetirem a mesma escolha.
    displayValue: p.deal?.value != null ? Number(p.deal.value) : p.value != null ? Number(p.value) : null,
    openRequestCount: p._count.requests,
    hasUnreadWhatsApp: p.contact ? unreadContactIds.has(p.contact.id) : false,
    hasUnreadNote: unreadNoteProcessIds.has(p.id),
  }));
}
