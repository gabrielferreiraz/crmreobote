import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDealScope, scopeWhere } from "@/lib/team-scope";
import { resolveAvatarUrlMap } from "@/lib/r2";
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

  const dealsRaw = await prisma.deal.findMany({
    where: {
      organizationId,
      pipelineId: activePipeline.id,
      ...scopeWhere(scope),
    },
    include: { contact: true, owner: true, stage: true },
    orderBy: { stageEnteredAt: "desc" },
  });

  const dealIds = dealsRaw.map((d) => d.id);
  const pendingTasks = await prisma.task.findMany({
    where: { dealId: { in: dealIds }, completedAt: null },
    orderBy: { dueAt: "asc" },
    select: { dealId: true, title: true, type: true },
  });
  const nextTaskByDeal = new Map<string, string>();
  const taskTypesByDeal = new Map<string, string[]>();
  for (const task of pendingTasks) {
    if (!task.dealId) continue;
    if (!nextTaskByDeal.has(task.dealId)) nextTaskByDeal.set(task.dealId, task.title);
    const types = taskTypesByDeal.get(task.dealId) ?? [];
    if (!types.includes(task.type)) types.push(task.type);
    taskTypesByDeal.set(task.dealId, types);
  }

  const avatarMap = await resolveAvatarUrlMap(dealsRaw.map((d) => d.owner.image));

  const deals = dealsRaw.map((deal) => ({
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
    contact: { id: deal.contact.id, name: deal.contact.name, source: deal.contact.source },
    owner: {
      id: deal.owner.id,
      name: deal.owner.name,
      photoUrl: deal.owner.image ? (avatarMap.get(deal.owner.image) ?? null) : null,
    },
    nextActivity: nextTaskByDeal.get(deal.id) ?? null,
    taskTypes: taskTypesByDeal.get(deal.id) ?? [],
  }));

  const membersRaw = await prisma.organizationUser.findMany({
    where: { organizationId, active: true },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { id: true, name: true } } },
  });

  const members =
    scope.type === "owners"
      ? membersRaw.filter((m) => scope.ownerIds.includes(m.userId))
      : membersRaw;

  const isOwner = session!.user.role === "OWNER";

  return (
    <div className="flex h-full flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Pipeline</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{activePipeline.name}</p>
      </div>
      <PipelineView
        pipelineId={activePipeline.id}
        pipelines={pipelines.map((p) => ({ id: p.id, name: p.name }))}
        stages={activePipeline.stages}
        initialDeals={deals}
        members={members.map((m) => m.user)}
        isOwner={isOwner}
        openNewDeal={novo === "1"}
      />
    </div>
  );
  });
}
