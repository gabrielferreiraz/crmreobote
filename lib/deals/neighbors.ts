/**
 * Negócio anterior e próximo ao que está aberto (setas da tela do negócio).
 *
 * A "fila" é a coluna do Kanban: mesmo funil e etapa, só em andamento, na
 * ordem padrão dele (entrou há menos tempo na etapa primeiro, id como
 * desempate — a mesma de fetchDealsList). Filtros e ordenação escolhidos no
 * Kanban ficam no navegador e não entram aqui.
 *
 * Não carrega a coluna inteira (há etapas com milhares de negócios): são duas
 * consultas de uma linha cada, partindo da posição do negócio atual.
 */
import { prisma } from "@/lib/prisma";
import { buildDealsWhere } from "@/lib/deals/list-query";
import type { DealScope } from "@/lib/team-scope";

export type DealNeighbors = { prevDealId: string | null; nextDealId: string | null };

export async function findDealNeighbors(args: {
  organizationId: string;
  /** O que a pessoa pode ver — a seta nunca leva a um negócio fora disso. */
  scope: DealScope;
  deal: {
    id: string;
    pipelineId: string;
    stageId: string;
    stageEnteredAt: Date;
    status: "OPEN" | "WON" | "LOST";
    archivedAt: Date | null;
  };
}): Promise<DealNeighbors> {
  const { organizationId, scope, deal } = args;
  // Ganho, perdido ou arquivado não está em coluna nenhuma do Kanban.
  if (deal.status !== "OPEN" || deal.archivedAt) return { prevDealId: null, nextDealId: null };

  // Já traz a organização, a permissão e o "não arquivado".
  const queue = buildDealsWhere({
    organizationId,
    scope,
    pipelineId: deal.pipelineId,
    stageId: deal.stageId,
    status: "OPEN",
  });

  const [previous, next] = await Promise.all([
    // Quem vem logo ANTES: mais recente na etapa (ou empatado, com id maior).
    prisma.deal.findFirst({
      where: {
        AND: [
          queue,
          {
            OR: [
              { stageEnteredAt: { gt: deal.stageEnteredAt } },
              { stageEnteredAt: deal.stageEnteredAt, id: { gt: deal.id } },
            ],
          },
        ],
      },
      // Ordem invertida: o primeiro que sai é o vizinho mais próximo.
      orderBy: [{ stageEnteredAt: "asc" }, { id: "asc" }],
      select: { id: true },
    }),
    // Quem vem logo DEPOIS.
    prisma.deal.findFirst({
      where: {
        AND: [
          queue,
          {
            OR: [
              { stageEnteredAt: { lt: deal.stageEnteredAt } },
              { stageEnteredAt: deal.stageEnteredAt, id: { lt: deal.id } },
            ],
          },
        ],
      },
      orderBy: [{ stageEnteredAt: "desc" }, { id: "desc" }],
      select: { id: true },
    }),
  ]);

  return { prevDealId: previous?.id ?? null, nextDealId: next?.id ?? null };
}
