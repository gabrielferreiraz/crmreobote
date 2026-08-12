import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveAvatarUrlMap } from "@/lib/r2";
import { scopeWhere, type DealScope } from "@/lib/team-scope";
import { classifyTaskUrgency, TASK_URGENCY_RANK } from "@/lib/task-urgency";

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
  /** Prazo da mesma tarefa pendente mais próxima que já vira `nextActivity`
   * (ver fetchDealsList) — usado por classifyTaskUrgency (lib/task-urgency.ts)
   * pra faixa de tarefa do card e pro filtro/sort "Ação hoje"/"Urgência" do
   * Pipeline (ver new-design-for-claude/README.md). */
  nextTaskDueAt: Date | null;
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
  /** Sigla exata (UF) do estado do contato. */
  state?: string;
  /** Por trecho (contains) da cidade do contato. */
  city?: string;
  createdFrom?: Date;
  createdTo?: Date;
  closedFrom?: Date;
  closedTo?: Date;
  /** Ex.: "negócios parados" na Início — etapa não muda há X dias. */
  stageEnteredBefore?: Date;
  /** Só negócios Ganhos que ainda não viraram Processo de pós-venda — usado
   * pela busca de "Adicionar ao processo" (ver app/(dashboard)/processos).
   * `Deal.process` é a relação 1-1 opcional já existente. */
  withoutProcess?: boolean;
  /** Filtro "Sem tarefa" do redesign (Início/Pipeline) — nenhuma tarefa
   * pendente vinculada. */
  hasNoOpenTask?: boolean;
  /** Filtro "Ação hoje" do redesign — tem tarefa pendente com prazo até esta
   * data (cobre atrasada + hoje num limite só). */
  taskDueBefore?: Date;
  /** Filtro "Sem valor" do redesign — `value` nulo ou zero. */
  noValue?: boolean;
};

/**
 * Monta o `where` uma vez só, reaproveitado tanto pela busca da página quanto
 * pela contagem (`countDeals`) — precisam SEMPRE bater, senão a paginação
 * mostra "página 3 de 5" e a página 3 vem vazia porque a contagem usou um
 * filtro diferente do da busca.
 */
export function buildDealsWhere(params: DealsFilterParams): Prisma.DealWhereInput {
  const {
    organizationId,
    pipelineId,
    scope,
    status,
    q,
    ownerIds,
    stageId,
    lossReasonId,
    jobTitle,
    source,
    state,
    city,
    createdFrom,
    createdTo,
    closedFrom,
    closedTo,
    stageEnteredBefore,
    withoutProcess,
    hasNoOpenTask,
    taskDueBefore,
    noValue,
  } = params;

  const where: Prisma.DealWhereInput = {
    organizationId,
    ...(pipelineId ? { pipelineId } : {}),
    ...(status ? { status } : {}),
    ...(stageId ? { stageId } : {}),
    ...(lossReasonId ? { lossReasonId } : {}),
    ...(stageEnteredBefore ? { stageEnteredAt: { lte: stageEnteredBefore } } : {}),
    ...(withoutProcess ? { process: null } : {}),
    ...(hasNoOpenTask ? { tasks: { none: { completedAt: null } } } : {}),
    ...(taskDueBefore ? { tasks: { some: { completedAt: null, dueAt: { lte: taskDueBefore } } } } : {}),
  };

  // scopeWhere (autorização por papel — o que o usuário TEM PERMISSÃO de ver)
  // e o filtro de responsável (o que o usuário ESCOLHEU ver) incidem sobre o
  // mesmo campo (ownerId) — nunca podem ser combinados via spread num mesmo
  // objeto: a chave que vier depois sobrescreve a outra em silêncio, e o
  // filtro escolhido pelo usuário (vindo direto da query string) acabava
  // descartando de vez a restrição de escopo, deixando um MEMBER/SUPERVISOR
  // pedir `?ownerId=<qualquer um>` e ver negócio de qualquer pessoa da
  // organização. Sempre em AND — o resultado só pode ser negócio cujo dono
  // esteja DENTRO do escopo permitido E dentro do filtro escolhido.
  //
  // Mesmo raciocínio vale pra qualquer bloco em formato OR (busca por texto,
  // "sem valor") — cada um entra como seu PRÓPRIO elemento do array AND,
  // nunca atribuído direto a `where.OR` (um segundo OR atribuído depois
  // sobrescreveria o primeiro em silêncio, exatamente o mesmo bug).
  const andConditions: Prisma.DealWhereInput[] = [];

  const scopeFilter = scopeWhere(scope);
  const ownerFilter = ownerIds && ownerIds.length > 0 ? { ownerId: { in: ownerIds } } : null;
  if (Object.keys(scopeFilter).length > 0) andConditions.push(scopeFilter);
  if (ownerFilter) andConditions.push(ownerFilter);

  if (q) {
    andConditions.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { contact: { name: { contains: q, mode: "insensitive" } } },
        { owner: { name: { contains: q, mode: "insensitive" } } },
      ],
    });
  }

  if (noValue) {
    andConditions.push({ OR: [{ value: null }, { value: 0 }] });
  }

  if (andConditions.length > 0) {
    where.AND = andConditions;
  }

  if (jobTitle || source || state || city) {
    where.contact = {
      ...(jobTitle ? { jobTitle } : {}),
      ...(source ? { source } : {}),
      ...(state ? { state } : {}),
      ...(city ? { city: { contains: city, mode: "insensitive" } } : {}),
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
 * Mesma ideia de aggregateDealValues, mas contando por etapa — usado pelo
 * Kanban (ver app/(dashboard)/pipeline/page.tsx e kanban-board.tsx) pra saber
 * o total de verdade de cada coluna sem precisar carregar todos os negócios
 * pra memória só pra contar (o Kanban busca só uma página por etapa, ver
 * fetchDealsList abaixo). Reaproveita buildDealsWhere — nunca duplicar esse
 * filtro à mão, senão a contagem sai de sincronia com o que a busca traz de
 * verdade (foi um bug real entre fetchDealsList/countDeals antes).
 */
/**
 * Traz `_sum.value` junto (mesma query, zero custo extra) — corrige um bug
 * real do Kanban: o cabeçalho de coluna somava só os cards já CARREGADOS
 * (uma página), errado em qualquer etapa com mais de uma página (ex.: a
 * etapa de milhares de negócios do redesign). Retorno mudou de forma
 * (Record<string, number> → Record<string, {count, sumValue}>) — os dois
 * call-sites (pipeline/page.tsx, api/deals/stage-counts) e o consumidor
 * (kanban-board.tsx) precisam ser atualizados juntos.
 */
export async function countDealsByStage(
  params: DealsFilterParams,
): Promise<Record<string, { count: number; sumValue: number }>> {
  const groups = await prisma.deal.groupBy({
    by: ["stageId"],
    where: buildDealsWhere(params),
    _count: { _all: true },
    _sum: { value: true },
  });
  return Object.fromEntries(
    groups.map((g) => [g.stageId, { count: g._count._all, sumValue: g._sum.value ? Number(g._sum.value) : 0 }]),
  );
}

/**
 * % de negócios de cada etapa com pelo menos uma tarefa pendente ("saúde da
 * etapa", ver new-design-for-claude/README.md) — N chamadas `prisma.deal.count`
 * em paralelo (uma por etapa, ~8 etapas típicas), reaproveitando
 * buildDealsWhere. Não usa SQL cru: o wrapper de RLS (ver lib/prisma.ts) só
 * intercepta operação de MODELO, não `$queryRaw` — SQL cru aqui exigiria
 * `prismaRaw.$transaction`+`setTenantOnTx` e duplicar a cláusula WHERE fora
 * do builder único, o mesmo risco de count/fetch saírem de sincronia que
 * este arquivo evita de propósito em todo o resto. N pequeno (poucas
 * etapas) torna N-queries-em-paralelo a opção mais simples seguindo o
 * padrão já estabelecido aqui.
 */
export async function countDealsWithTaskByStage(
  params: DealsFilterParams,
  stageIds: string[],
): Promise<Record<string, number>> {
  const entries = await Promise.all(
    stageIds.map(async (stageId) => {
      const count = await prisma.deal.count({
        where: { ...buildDealsWhere({ ...params, stageId }), tasks: { some: { completedAt: null } } },
      });
      return [stageId, count] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * Busca e enriquece negócios (próxima atividade pendente, WhatsApp não lido,
 * foto do responsável) — usado tanto pela renderização inicial da página
 * (Kanban e 1ª página da Lista, ver page.tsx) quanto pela paginação da Lista
 * (GET /api/deals) — extraído pra um lugar só pra nunca duplicar essa lógica
 * em dois pontos e eles saírem de sincronia.
 */
// `select` em vez de `include: { owner: true, contact: true, ... }` — owner é
// um User inteiro (senha com hash, e-mail etc.) e contact tem campos
// potencialmente grandes (customFields JSON, endereço completo) que o
// `.map()` de fetchDealsList nunca usa; numa lista de até 200+5000 linhas
// (Lista + Kanban) isso é bytes reais trafegados do Postgres à toa.
// Extraído como constante — o sort "Urgência" abaixo precisa de uma 2ª
// consulta com esse mesmo select, e duplicar o objeto à mão é como esse
// tipo de coisa sai de sincronia sem ninguém notar.
const DEAL_LIST_SELECT = {
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
} satisfies Prisma.DealSelect;

// Teto de candidatos pro sort "Urgência" (ver fetchDealsRawByUrgency) — sem
// filtro nenhum aplicado, o funil inteiro pode chegar a milhares de
// negócios, e não existe orderBy nativo do Prisma por "data da tarefa
// pendente mais próxima" (é um agregado de relação to-many). Na prática
// quem usa esse sort quase sempre já tem algum filtro ativo; o teto só
// protege o caso extremo (funil inteiro, sem filtro nenhum) — ordenado por
// stageEnteredAt desc ANTES do corte, então o que fica de fora é sempre o
// que está há mais tempo parado, não uma amostra aleatória.
const URGENCY_SORT_CANDIDATE_CAP = 3000;

/**
 * Sort "Urgência" (atrasada→hoje→agendada→sem-tarefa, ver lib/task-urgency.ts)
 * — Prisma não ordena por agregado de relação to-many direto, então em vez
 * de SQL cru (mesmo motivo de countDealsWithTaskByStage acima: RLS só
 * intercepta operação de modelo, duplicar o WHERE fora de buildDealsWhere é
 * o risco que este arquivo evita), busca os ids candidatos, o prazo mais
 * próximo de cada um via groupBy, classifica/ordena em JS, corta a página
 * pedida e só then busca as linhas completas dessa página.
 */
async function fetchDealsRawByUrgency(params: DealsFilterParams, skip: number, take: number) {
  const candidates = await prisma.deal.findMany({
    where: buildDealsWhere(params),
    select: { id: true },
    orderBy: { stageEnteredAt: "desc" },
    take: URGENCY_SORT_CANDIDATE_CAP,
  });
  const candidateIds = candidates.map((d) => d.id);
  if (candidateIds.length === 0) return [];

  const earliestDue = await prisma.task.groupBy({
    by: ["dealId"],
    where: { dealId: { in: candidateIds }, completedAt: null },
    _min: { dueAt: true },
  });
  const dueByDeal = new Map(earliestDue.filter((t) => t.dealId).map((t) => [t.dealId as string, t._min.dueAt]));

  const ranked = candidateIds
    .map((id) => {
      const dueAt = dueByDeal.get(id) ?? null;
      return { id, dueAt, rank: TASK_URGENCY_RANK[classifyTaskUrgency(dueAt)] };
    })
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      const at = a.dueAt ? a.dueAt.getTime() : Infinity;
      const bt = b.dueAt ? b.dueAt.getTime() : Infinity;
      return at - bt;
    });

  const pageIds = ranked.slice(skip, skip + take).map((r) => r.id);
  if (pageIds.length === 0) return [];

  const rows = await prisma.deal.findMany({ where: { id: { in: pageIds } }, select: DEAL_LIST_SELECT });
  const byId = new Map(rows.map((r) => [r.id, r]));
  // findMany com `id: { in }` não garante a ordem — reordena pra bater com
  // o ranking calculado acima.
  return pageIds.map((id) => byId.get(id)).filter((d): d is NonNullable<typeof d> => !!d);
}

export async function fetchDealsList(
  params: DealsFilterParams & {
    skip?: number;
    take: number;
    sortDir?: "asc" | "desc";
    /** "value"/"stale" = Valor/Parado do redesign (orderBy trivial);
     * "urgency" = Urgência (ver fetchDealsRawByUrgency); ausente = ordenação
     * padrão de sempre (stageEnteredAt, respeitando sortDir). */
    sort?: "value" | "stale" | "urgency";
  },
): Promise<EnrichedDeal[]> {
  const { organizationId, skip = 0, take, sortDir = "desc", sort } = params;

  const dealsRaw =
    sort === "urgency"
      ? await fetchDealsRawByUrgency(params, skip, take)
      : await prisma.deal.findMany({
          where: buildDealsWhere(params),
          select: DEAL_LIST_SELECT,
          orderBy:
            sort === "value"
              ? { value: "desc" }
              : sort === "stale"
                ? { stageEnteredAt: "asc" } // mais tempo parado primeiro
                : { stageEnteredAt: sortDir }, // padrão de sempre — sortDir chegava até aqui mas nunca era aplicado (bug pré-existente, corrigido de passagem)
          skip,
          take,
        });

  if (dealsRaw.length === 0) return [];

  const dealIds = dealsRaw.map((d) => d.id);
  const [pendingTasks, unreadMessages, avatarMap] = await Promise.all([
    prisma.task.findMany({
      where: { dealId: { in: dealIds }, completedAt: null },
      orderBy: { dueAt: "asc" },
      select: { dealId: true, title: true, type: true, dueAt: true },
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
  const nextTaskDueAtByDeal = new Map<string, Date>();
  const taskTypesByDeal = new Map<string, string[]>();
  for (const task of pendingTasks) {
    if (!task.dealId) continue;
    // Tarefas já vêm ordenadas por dueAt asc (ver a query acima) — a primeira
    // que a gente vê pra cada negócio já É a mais próxima, então nextActivity/
    // nextTaskDueAt são sempre da mesma tarefa (nunca duas fontes diferentes).
    if (!nextTaskByDeal.has(task.dealId)) {
      nextTaskByDeal.set(task.dealId, task.title);
      if (task.dueAt) nextTaskDueAtByDeal.set(task.dealId, task.dueAt);
    }
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
    nextTaskDueAt: nextTaskDueAtByDeal.get(deal.id) ?? null,
    taskTypes: taskTypesByDeal.get(deal.id) ?? [],
    hasUnreadWhatsApp: unreadContactIds.has(deal.contactId),
    lossReasonId: deal.lossReasonId,
    lossReason: deal.lossReason ? { id: deal.lossReason.id, label: deal.lossReason.label } : null,
    lostReason: deal.lostReason,
  }));
}

export type LiteDeal = {
  id: string;
  name: string;
  value: number | null;
  contact: { name: string };
  owner: { name: string };
};

/**
 * Versão enxuta de fetchDealsList — só os 5 campos que uma busca tipo
 * autocomplete (ex.: "Adicionar ao processo") de fato mostra. `fetchDealsList`
 * é pesada de propósito pra alimentar a tela de Lista (busca foto do
 * responsável no R2, próxima atividade, WhatsApp não lido) — cada uma dessas
 * é uma ida-e-volta a mais (R2 inclusive, não só banco), e nenhuma aparece
 * numa lista de resultado de busca. Medido: ~900ms com fetchDealsList vs
 * a consulta única daqui.
 */
export async function fetchDealsLite(params: DealsFilterParams & { take: number }): Promise<LiteDeal[]> {
  const rows = await prisma.deal.findMany({
    where: buildDealsWhere(params),
    select: {
      id: true,
      name: true,
      value: true,
      contact: { select: { name: true } },
      owner: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: params.take,
  });

  return rows.map((d) => ({
    id: d.id,
    name: d.name,
    value: d.value != null ? Number(d.value) : null,
    contact: d.contact,
    owner: d.owner,
  }));
}
