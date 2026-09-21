import { prisma } from "@/lib/prisma";
import type { DealScope } from "@/lib/team-scope";

/**
 * "Quais negócios essa pessoa fechou" — a lista por trás do número do card
 * "Negócios fechados" do relatório (ver lib/reports/commercial-data.ts,
 * dealsClosedRanking). Usada pelo painel do ranking (GET
 * /api/reports/won-deals) e pela página completa de ganhos de uma pessoa
 * (app/(dashboard)/relatorios/ganhos/[userId]).
 *
 * O `where` é o MESMO da agregação do ranking (status WON + closedAt no
 * período + funil, por dono) — de propósito, pra o total desta lista nunca
 * divergir do número que a pessoa clicou pra abrir.
 */
export type WonDealRow = {
  id: string;
  name: string;
  contactId: string;
  contactName: string;
  /** Valor líquido — o mesmo que o ranking soma. */
  value: number;
  grossValue: number | null;
  creditType: string | null;
  closedAt: string | null;
  pipelineName: string;
};

export type WonDealsResult = {
  items: WonDealRow[];
  total: number;
  sumValue: number;
  sumGrossValue: number;
  firstClosedAt: string | null;
  lastClosedAt: string | null;
};

export function ownerInScope(scope: DealScope, ownerId: string): boolean {
  return scope.type === "all" || scope.ownerIds.includes(ownerId);
}

/**
 * Devolve null quando `ownerId` está fora do escopo de quem pediu — nunca
 * uma lista vazia, pra a rota conseguir responder 403/404 em vez de fingir
 * que a pessoa "não fechou nada" (e nunca vazar deal de quem o papel de
 * quem pede não enxerga: Gerente só vê o próprio time, Supervisor só a
 * equipe, Consultor só o próprio — mesma régua de getDealScope).
 */
export async function fetchWonDeals(params: {
  organizationId: string;
  scope: DealScope;
  ownerId: string;
  from?: Date | null;
  to?: Date | null;
  pipelineId?: string | null;
  skip?: number;
  take: number;
}): Promise<WonDealsResult | null> {
  const { organizationId, scope, ownerId, from, to, pipelineId, skip = 0, take } = params;
  if (!ownerInScope(scope, ownerId)) return null;

  const where = {
    organizationId,
    status: "WON" as const,
    ownerId,
    ...(pipelineId ? { pipelineId } : {}),
    ...(from || to ? { closedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };

  // Em paralelo — cada operação do Prisma custa várias idas-e-voltas ao
  // Postgres por causa da transação de RLS (ver withTenantRls em lib/prisma.ts).
  const [rows, agg] = await Promise.all([
    prisma.deal.findMany({
      where,
      // Mais recente primeiro; id desempata pra "carregar mais" nunca repetir
      // nem pular linha quando vários negócios fecham no mesmo instante.
      orderBy: [{ closedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
      skip,
      take,
      select: {
        id: true,
        name: true,
        value: true,
        grossValue: true,
        creditType: true,
        closedAt: true,
        contact: { select: { id: true, name: true } },
        pipeline: { select: { name: true } },
      },
    }),
    prisma.deal.aggregate({
      where,
      _count: true,
      _sum: { value: true, grossValue: true },
      _min: { closedAt: true },
      _max: { closedAt: true },
    }),
  ]);

  return {
    items: rows.map((d) => ({
      id: d.id,
      name: d.name,
      contactId: d.contact.id,
      contactName: d.contact.name,
      value: d.value ? Number(d.value) : 0,
      grossValue: d.grossValue ? Number(d.grossValue) : null,
      creditType: d.creditType,
      closedAt: d.closedAt ? d.closedAt.toISOString() : null,
      pipelineName: d.pipeline.name,
    })),
    total: agg._count,
    sumValue: agg._sum.value ? Number(agg._sum.value) : 0,
    sumGrossValue: agg._sum.grossValue ? Number(agg._sum.grossValue) : 0,
    firstClosedAt: agg._min.closedAt ? agg._min.closedAt.toISOString() : null,
    lastClosedAt: agg._max.closedAt ? agg._max.closedAt.toISOString() : null,
  };
}
