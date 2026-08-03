import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDealScope, scopeWhere } from "@/lib/team-scope";
import { fetchDealsList, aggregateDealValues } from "@/lib/deals/list-query";
import { runWithTenant } from "@/lib/tenant-context";
import { PipelineView } from "./pipeline-view";

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
    ]);

    const activePipeline =
      pipelines.find((p) => p.id === pipelineIdParam) ??
      pipelines.find((p) => p.isDefault) ??
      pipelines[0];

    if (!activePipeline) {
      return <p className="text-neutral-400 dark:text-neutral-500">Nenhum pipeline configurado.</p>;
    }

    // Kanban e Lista têm necessidades diferentes: o Kanban só mostra OPEN (é o
    // funil de trabalho de verdade, precisa vir completo pra reordenar/arrastar
    // direito) — o teto aqui é só uma rede de segurança, praticamente nunca
    // deve ser atingido (o volume de negócios OPEN é limitado pela capacidade
    // de trabalho da equipe, diferente do histórico de Ganhos/Perdidos, que só
    // cresce). A Lista usa paginação de verdade (ver deals-list.tsx e GET
    // /api/deals) — essa é só a 1ª página, no tamanho padrão do seletor de
    // itens por página, pra abrir a tela sem precisar de um fetch extra.
    const KANBAN_FETCH_CAP = 5000;
    const LISTA_DEFAULT_PAGE_SIZE = 50;

    const listaFilterParams = { organizationId, pipelineId: activePipeline.id, scope };

    const [kanbanDeals, listaDeals, listaTotalCount, listaSums] = await Promise.all([
      fetchDealsList({
        organizationId,
        pipelineId: activePipeline.id,
        scope,
        status: "OPEN",
        take: KANBAN_FETCH_CAP,
      }),
      fetchDealsList({ ...listaFilterParams, take: LISTA_DEFAULT_PAGE_SIZE }),
      prisma.deal.count({
        where: { organizationId, pipelineId: activePipeline.id, ...scopeWhere(scope) },
      }),
      aggregateDealValues(listaFilterParams),
    ]);

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

  const isOwner = session!.user.role === "OWNER";
  const isManager = ["OWNER", "MANAGER"].includes(session!.user.role ?? "");
  // Liberado pra todo mundo — a rota (app/api/deals/bulk-send-message) já
  // revalida a seleção contra getDealScope/scopeWhere do próprio papel de
  // quem chama, então um Consultor só consegue mesmo mandar mensagem pros
  // negócios que já são dele, nunca de outra pessoa.
  const canBulkMessage = true;

  return (
    <div className="flex h-full flex-col gap-4">
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
        initialKanbanDeals={kanbanDeals}
        initialListaDeals={listaDeals}
        listaTotalCount={listaTotalCount}
        listaSums={listaSums}
        currentUserId={userId}
        members={members.map((m) => m.user)}
        allMembers={allMembersForFilter.map((m) => ({ ...m.user, active: m.active }))}
        lossReasons={lossReasons.map((r) => ({ id: r.id, label: r.label }))}
        customFields={customFields}
        creditTypes={creditTypes.map((c) => ({ id: c.id, label: c.label }))}
        isOwner={isOwner}
        canBulkDelete={isManager}
        canBulkMessage={canBulkMessage}
        openNewDeal={novo === "1"}
      />
    </div>
  );
  });
}
