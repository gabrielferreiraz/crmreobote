/**
 * Divisão do negócio entre responsáveis (co-responsáveis) — regras de ACESSO
 * e leitura, lado servidor. A matemática pura fica em split-shares.ts.
 *
 * Co-responsável = mesmo poder do responsável sobre o negócio (ver, editar,
 * mover, ganho/perdido, atividades, propostas, tarefas do negócio, o cliente),
 * EXCETO apagar o negócio e mexer na divisão — a mesma regra do "coautor via
 * grupo de compartilhamento" (ver getSharedScope, DELETE em
 * app/api/deals/[id]/route.ts).
 */

import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { DealScope } from "@/lib/team-scope";
import { computeDealShares, shareOfValue } from "@/lib/deals/split-shares";

/**
 * Filtro de NEGÓCIO por escopo: o mesmo `ownerId in escopo` de sempre MAIS os
 * negócios em que alguém do escopo é co-responsável. Devolve o filtro dentro
 * de `AND` (nunca `OR` solto): quem espalha isto num `where` que já tem `OR`
 * (ex.: Início, busca) não perde a restrição de acesso por chave repetida.
 */
export function dealScopeWhere(scope: DealScope): Prisma.DealWhereInput {
  if (scope.type !== "owners") return {};
  const ids = { in: scope.ownerIds };
  return { AND: [{ OR: [{ ownerId: ids }, { participants: { some: { userId: ids } } }] }] };
}

/**
 * Filtro de TAREFA por escopo, pras rotas que abrem UMA tarefa por id: a tarefa
 * é de alguém do escopo (como sempre) OU pertence a um negócio em que alguém do
 * escopo é co-responsável — sem isso o co-responsável via a tarefa do negócio
 * na tela e levava "não encontrado" ao tentar concluí-la. Listas (Agenda) NÃO
 * usam isto: continuam só com as tarefas de cada um.
 */
export function taskScopeWhere(scope: DealScope): Prisma.TaskWhereInput {
  if (scope.type !== "owners") return {};
  const ids = { in: scope.ownerIds };
  return { AND: [{ OR: [{ ownerId: ids }, { deal: { participants: { some: { userId: ids } } } }] }] };
}

/** Ids dos negócios em que alguém do escopo é co-responsável (pra consultas SQL cruas, que não usam o Prisma). */
export async function coOwnedDealIds(organizationId: string, scope: DealScope, limit = 1000): Promise<string[]> {
  if (scope.type !== "owners" || scope.ownerIds.length === 0) return [];
  const rows = await prisma.dealParticipant.findMany({
    where: { organizationId, userId: { in: scope.ownerIds } },
    select: { dealId: true },
    take: limit,
  });
  return rows.map((r) => r.dealId);
}

/** O usuário é co-responsável de ALGUM negócio deste cliente? (libera o consultor a abrir/editar o cliente do negócio dividido.) */
export async function isCoOwnerOfContact(organizationId: string, userId: string, contactId: string): Promise<boolean> {
  const found = await prisma.dealParticipant.findFirst({
    where: { organizationId, userId, deal: { contactId } },
    select: { id: true },
  });
  return !!found;
}

/** O usuário é co-responsável DESTE negócio? */
export async function isCoOwnerOfDeal(organizationId: string, userId: string, dealId: string): Promise<boolean> {
  const found = await prisma.dealParticipant.findFirst({
    where: { organizationId, userId, dealId },
    select: { id: true },
  });
  return !!found;
}

// ─── Rankings: a venda conta pros dois, cada um com a PARTE dele ─────────────

/**
 * Valor ganho por PESSOA (ranking da TV): negócio não dividido vai inteiro pro
 * responsável; negócio dividido soma a parte de cada um (principal e
 * co-responsáveis). `where` são os filtros do período; só entram em `personIds`.
 * Total da EMPRESA nunca sai daqui (continua somando o negócio uma vez só).
 */
export async function wonValueByPerson(args: {
  organizationId: string;
  where: Prisma.DealWhereInput;
  personIds: string[];
  /** Só pra teste (transação que é desfeita); no uso normal é o prisma com isolamento por organização. */
  db?: Prisma.TransactionClient;
}): Promise<Map<string, number>> {
  const { organizationId, where, personIds } = args;
  const client = (args.db ?? prisma) as Prisma.TransactionClient;
  const wanted = new Set(personIds);

  const plain = await client.deal.groupBy({
    by: ["ownerId"],
    where: { AND: [{ organizationId, status: "WON", ownerId: { in: personIds }, participants: { none: {} } }, where] },
    _sum: { value: true },
  });
  const totals = new Map<string, number>(plain.map((row) => [row.ownerId, Number(row._sum.value ?? 0)]));

  const divided = await client.deal.findMany({
    where: { AND: [{ organizationId, status: "WON", participants: { some: {} } }, where] },
    select: { ownerId: true, value: true, participants: { select: { userId: true, sharePercent: true } } },
  });
  for (const deal of divided) {
    const value = deal.value != null ? Number(deal.value) : null;
    for (const share of computeDealShares(deal.ownerId, deal.participants)) {
      if (!wanted.has(share.userId)) continue;
      totals.set(share.userId, (totals.get(share.userId) ?? 0) + (value != null ? shareOfValue(value, share.percent) : 0));
    }
  }
  return totals;
}

export type WonAdjustment = { count: number; value: number; grossValue: number };

/**
 * Ajuste a somar em "ganho por responsável principal" (Relatórios) pra a venda
 * contar pros dois: o principal continua com 1 venda mas só com a PARTE dele
 * do valor; cada co-responsável ganha 1 venda e a parte dele. Só considera
 * quem está no escopo de quem vê (`scope`). `filters` = período/funil/tags do
 * relatório, SEM escopo. Os totais da empresa não usam isto.
 */
export async function wonSplitAdjustments(args: {
  organizationId: string;
  scope: DealScope;
  filters: Prisma.DealWhereInput;
  /** Só pra teste (transação que é desfeita). */
  db?: Prisma.TransactionClient;
}): Promise<Map<string, WonAdjustment>> {
  const { organizationId, scope, filters } = args;
  const client = (args.db ?? prisma) as Prisma.TransactionClient;
  const adjustments = new Map<string, WonAdjustment>();

  const inScope = (userId: string) => scope.type === "all" || scope.ownerIds.includes(userId);
  const add = (userId: string, delta: Partial<WonAdjustment>) => {
    const current = adjustments.get(userId) ?? { count: 0, value: 0, grossValue: 0 };
    adjustments.set(userId, {
      count: current.count + (delta.count ?? 0),
      value: current.value + (delta.value ?? 0),
      grossValue: current.grossValue + (delta.grossValue ?? 0),
    });
  };

  const divided = await client.deal.findMany({
    where: { AND: [{ organizationId, status: "WON", participants: { some: {} } }, filters, dealScopeWhere(scope)] },
    select: {
      ownerId: true,
      value: true,
      grossValue: true,
      participants: { select: { userId: true, sharePercent: true } },
    },
  });
  for (const deal of divided) {
    const value = deal.value != null ? Number(deal.value) : 0;
    const gross = deal.grossValue != null ? Number(deal.grossValue) : 0;
    for (const share of computeDealShares(deal.ownerId, deal.participants)) {
      if (share.isPrincipal) {
        // Já contado inteiro (1 venda, valor cheio) no agrupamento por responsável: só troca pelo valor da parte.
        if (inScope(share.userId)) {
          add(share.userId, {
            value: shareOfValue(value, share.percent) - value,
            grossValue: shareOfValue(gross, share.percent) - gross,
          });
        }
      } else if (inScope(share.userId)) {
        add(share.userId, { count: 1, value: shareOfValue(value, share.percent), grossValue: shareOfValue(gross, share.percent) });
      }
    }
  }
  return adjustments;
}
