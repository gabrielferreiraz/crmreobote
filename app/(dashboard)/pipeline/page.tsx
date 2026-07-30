import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDealScope, scopeWhere } from "@/lib/team-scope";
import { fetchDealsList } from "@/lib/deals/list-query";
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
  const scope = await getDealScope(organizationId, userId, session!.user.role);

  const pipelines = await prisma.pipeline.findMany({
    where: { organizationId },
    orderBy: { order: "asc" },
    include: { stages: { orderBy: { order: "asc" } } },
  });

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
  // cresce). A Lista pode ver os 3 status, então usa paginação de verdade
  // (1ª página aqui, "carregar mais" busca o resto — ver deals-list.tsx e
  // GET /api/deals) em vez de um teto fixo com aviso de corte.
  const KANBAN_FETCH_CAP = 5000;
  const LISTA_PAGE_SIZE = 500;

  const [kanbanDeals, listaDeals, listaTotalCount] = await Promise.all([
    fetchDealsList({
      organizationId,
      pipelineId: activePipeline.id,
      scope,
      status: "OPEN",
      take: KANBAN_FETCH_CAP,
    }),
    fetchDealsList({
      organizationId,
      pipelineId: activePipeline.id,
      scope,
      take: LISTA_PAGE_SIZE,
    }),
    prisma.deal.count({
      where: { organizationId, pipelineId: activePipeline.id, ...scopeWhere(scope) },
    }),
  ]);
  const kanbanCapped = kanbanDeals.length === KANBAN_FETCH_CAP;

  const membersRaw = await prisma.organizationUser.findMany({
    where: { organizationId, active: true },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { id: true, name: true } } },
  });

  const members =
    scope.type === "owners"
      ? membersRaw.filter((m) => scope.ownerIds.includes(m.userId))
      : membersRaw;

  // Inclui inativos aqui — diferente de `members` (usado pra atribuir/criar
  // negócio, onde só faz sentido gente ativa), o filtro da lista precisa achar
  // negócios de quem já saiu do time.
  const allMembersRaw = await prisma.organizationUser.findMany({
    where: { organizationId },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
    include: { user: { select: { id: true, name: true } } },
  });
  const allMembersForFilter =
    scope.type === "owners"
      ? allMembersRaw.filter((m) => scope.ownerIds.includes(m.userId))
      : allMembersRaw;

  const lossReasons = await prisma.lossReason.findMany({
    where: { organizationId },
    orderBy: { order: "asc" },
  });

  const customFields = await prisma.customFieldDefinition.findMany({
    where: { organizationId, entityType: "DEAL" },
    orderBy: { order: "asc" },
  });

  const creditTypes = await prisma.creditType.findMany({
    where: { organizationId },
    orderBy: { order: "asc" },
  });

  const isOwner = session!.user.role === "OWNER";
  const isManager = ["OWNER", "MANAGER"].includes(session!.user.role ?? "");
  // Liberado a partir de Supervisor por enquanto (ver app/api/deals/bulk-send-message) —
  // pode abrir pra Membro/consultor mais pra frente, então fica isolado do
  // resto dos gates em vez de reaproveitar isManager.
  const canBulkMessage = ["OWNER", "MANAGER", "SUPERVISOR"].includes(session!.user.role ?? "");

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
        kanbanCapped={kanbanCapped}
        initialListaDeals={listaDeals}
        listaTotalCount={listaTotalCount}
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
