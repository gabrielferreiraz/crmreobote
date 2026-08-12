import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDealScope, scopeWhere } from "@/lib/team-scope";
import { fetchDealsList, aggregateDealValues, countDealsByStage, countDealsWithTaskByStage } from "@/lib/deals/list-query";
import { getCurrentMonthGoalProgress } from "@/lib/goals/suggestion";
import { runWithTenant } from "@/lib/tenant-context";
import { PipelineView } from "./pipeline-view";
import type { Deal } from "./kanban-board";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ pipelineId?: string; novo?: string }>;
}) {
  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const userId = session!.user.id;
  const { pipelineId: pipelineIdParam, novo } = await searchParams;

  return runWithTenant(organizationId, async () => {
    // Agrupa todas as consultas de metadados e escopo que não dependem do funil
    // ativo em uma única chamada paralela. Isso elimina um waterfall sequencial de
    // 5 consultas ao banco e reduz o tempo de carregamento da página drasticamente.
    const [
      scope,
      pipelines,
      allMembersRaw,
      lossReasons,
      customFields,
      creditTypes,
      leadSources,
      jobTitles,
    ] = await Promise.all([
      getDealScope(organizationId, userId, session!.user.role),
      prisma.pipeline.findMany({
        where: { organizationId },
        orderBy: { order: "asc" },
        include: { stages: { orderBy: { order: "asc" } } },
      }),
      prisma.organizationUser.findMany({
        where: { organizationId },
        orderBy: [{ active: "desc" }, { createdAt: "asc" }],
        include: { user: { select: { id: true, name: true } } },
      }),
      prisma.lossReason.findMany({
        where: { organizationId },
        orderBy: { order: "asc" },
      }),
      prisma.customFieldDefinition.findMany({
        where: { organizationId, entityType: "DEAL" },
        orderBy: { order: "asc" },
      }),
      prisma.creditType.findMany({
        where: { organizationId },
        orderBy: { order: "asc" },
      }),
      // Listas canônicas de Origem/Cargo (mesmas tabelas de configuracoes/
      // origens e configuracoes/cargos) — o Kanban busca só uma página por
      // etapa (ver abaixo), então não dá mais pra derivar as opções do
      // filtro só do que já carregou (uma etapa com poucos itens não teria
      // as opções que só aparecem em outra). kanban-board.tsx combina isso
      // com o que estiver carregado na tela, igual contacts-table.tsx já faz.
      prisma.leadSource.findMany({ where: { organizationId }, orderBy: { order: "asc" } }),
      prisma.jobTitle.findMany({ where: { organizationId }, orderBy: { order: "asc" } }),
    ]);

    const activePipeline =
      pipelines.find((p) => p.id === pipelineIdParam) ??
      pipelines.find((p) => p.isDefault) ??
      pipelines[0];

    if (!activePipeline) {
      return <p className="text-neutral-400 dark:text-neutral-500">Nenhum pipeline configurado.</p>;
    }

    // Kanban e Lista têm necessidades diferentes: a Lista usa paginação de
    // verdade (ver deals-list.tsx e GET /api/deals) — essa é só a 1ª página,
    // no tamanho padrão do seletor de itens por página, pra abrir a tela sem
    // precisar de um fetch extra. O Kanban só mostra OPEN, mas — diferente de
    // antes — também busca limitado, por ETAPA (uma página por coluna, com
    // "carregar mais" client-side em kanban-board.tsx), em vez de tentar
    // trazer o funil OPEN inteiro numa consulta só: com dezenas de milhares
    // de negócios reais, "buscar tudo de uma vez" não escala (medido: uma
    // consulta de até 5000 linhas levava vários segundos de SSR sozinha, e um
    // teto fixo ainda cortava negócio de verdade em silêncio quando excedido).
    // Uma consulta só (não uma por etapa): cada operação do Prisma aqui abre a
    // própria transação curta pra RLS (ver withTenantRls em lib/prisma.ts) —
    // buscar por etapa em paralelo (uma consulta + 3 de enriquecimento cada)
    // multiplicava demais o número de transações/conexões simultâneas contra
    // um Postgres remoto e chegou a estourar o timeout de 15s por operação
    // com o pool sobrecarregado. Uma única busca, com teto bem menor que o
    // 5000 de antes, e depois agrupada por etapa em memória — ainda assim é
    // sempre completo (nada cortado em silêncio): countDealsByStage abaixo dá
    // o total de verdade de cada coluna, e "carregar mais" busca só a etapa
    // que precisa, uma de cada vez, quando o usuário realmente rola até lá.
    const KANBAN_INITIAL_CAP = 400;
    const LISTA_DEFAULT_PAGE_SIZE = 50;

    const listaFilterParams = { organizationId, pipelineId: activePipeline.id, scope };
    const kanbanFilterParams = { organizationId, pipelineId: activePipeline.id, scope, status: "OPEN" as const };

    // % da meta no card "valor em aberto" (ver new-design-for-claude/README.md)
    // só faz sentido pra quem vê o funil inteiro (Dono) — meta é sempre
    // organização inteira, dividir um "aberto" já ESCOPADO (Gerente/
    // Supervisor/Consultor) pela meta do time todo daria uma % sem
    // significado real pra quem não vê tudo.
    const isOwnerForGoal = session!.user.role === "OWNER";

    const [openStatsByStage, kanbanDeals, listaDeals, listaTotalCount, listaSums, goalProgress] = await Promise.all([
      // {count, sumValue} por etapa — sumValue corrige um bug real do
      // cabeçalho da coluna, que antes somava só os negócios já CARREGADOS
      // (uma página), errado em qualquer etapa com mais de uma página.
      countDealsByStage(kanbanFilterParams),
      fetchDealsList({ ...kanbanFilterParams, take: KANBAN_INITIAL_CAP }),
      fetchDealsList({ ...listaFilterParams, take: LISTA_DEFAULT_PAGE_SIZE }),
      prisma.deal.count({
        where: { organizationId, pipelineId: activePipeline.id, ...scopeWhere(scope) },
      }),
      aggregateDealValues(listaFilterParams),
      isOwnerForGoal ? getCurrentMonthGoalProgress(organizationId) : Promise.resolve(null),
    ]);
    const initialKanbanByStage: Record<string, Deal[]> = {};
    for (const deal of kanbanDeals) {
      (initialKanbanByStage[deal.stageId] ??= []).push(deal);
    }
    // "Saúde da etapa" (ver new-design-for-claude/README.md) — % de negócios
    // com tarefa pendente. Só pras etapas que de fato têm negócio (etapa
    // vazia não precisa de consulta, a saúde não tem o que mostrar mesmo).
    const openCountByStage: Record<string, number> = {};
    for (const [stageId, stats] of Object.entries(openStatsByStage)) openCountByStage[stageId] = stats.count;
    const stagesWithDeals = activePipeline.stages.filter((s) => (openCountByStage[s.id] ?? 0) > 0).map((s) => s.id);
    const openWithTaskByStage =
      stagesWithDeals.length > 0 ? await countDealsWithTaskByStage(kanbanFilterParams, stagesWithDeals) : {};

    // Uma consulta só, cobrindo ativos e inativos — `active desc` já deixa os
    // ativos primeiro (em createdAt asc entre si), então dá pra derivar
    // `membersRaw` (só ativos, usado pra atribuir/criar negócio) filtrando em
    // memória em vez de repetir a mesma consulta com um `where` mais estreito.
    const membersRaw = allMembersRaw.filter((m) => m.active);

    const members =
      scope.type === "owners"
        ? membersRaw.filter((m) => scope.ownerIds.includes(m.userId))
        : membersRaw;

    // Inclui inativos aqui — diferente de `members` acima, o filtro da lista
    // precisa achar negócios de quem já saiu do time.
    const allMembersForFilter =
      scope.type === "owners"
        ? allMembersRaw.filter((m) => scope.ownerIds.includes(m.userId))
        : allMembersRaw;

  const isOwner = isOwnerForGoal;
  const isManager = ["OWNER", "MANAGER"].includes(session!.user.role ?? "");
  // Liberado pra todo mundo — a rota (app/api/deals/bulk-send-message) já
  // revalida a seleção contra getDealScope/scopeWhere do próprio papel de
  // quem chama, então um Consultor só consegue mesmo mandar mensagem pros
  // negócios que já são dele, nunca de outra pessoa.
  const canBulkMessage = true;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Pipeline</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{activePipeline.name}</p>
      </div>
      <PipelineView
        pipelineId={activePipeline.id}
        pipelines={pipelines.map((p) => ({
          id: p.id,
          name: p.name,
          stages: p.stages.map((s) => ({ id: s.id, name: s.name })),
        }))}
        stages={activePipeline.stages}
        initialKanbanByStage={initialKanbanByStage}
        initialKanbanCountByStage={openCountByStage}
        initialKanbanSumByStage={Object.fromEntries(
          Object.entries(openStatsByStage).map(([stageId, stats]) => [stageId, stats.sumValue]),
        )}
        initialKanbanWithTaskByStage={openWithTaskByStage}
        initialListaDeals={listaDeals}
        listaTotalCount={listaTotalCount}
        listaSums={listaSums}
        currentUserId={userId}
        members={members.map((m) => m.user)}
        allMembers={allMembersForFilter.map((m) => ({ ...m.user, active: m.active }))}
        lossReasons={lossReasons.map((r) => ({ id: r.id, label: r.label }))}
        customFields={customFields}
        creditTypes={creditTypes.map((c) => ({ id: c.id, label: c.label }))}
        leadSources={leadSources.map((s) => ({ label: s.label }))}
        jobTitles={jobTitles.map((j) => ({ label: j.label }))}
        isOwner={isOwner}
        canBulkDelete={isManager}
        canBulkMessage={canBulkMessage}
        openNewDeal={novo === "1"}
        goalValue={goalProgress?.goalValue ?? null}
        goalAchievedValue={goalProgress?.achievedValue ?? null}
      />
    </div>
  );
  });
}
