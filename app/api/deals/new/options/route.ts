import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { getSharedScope } from "@/lib/share-groups";
import { runWithTenant } from "@/lib/tenant-context";
import { PIPELINE_LAST_ID_COOKIE } from "@/lib/pipeline-last-selected";

export const dynamic = "force-dynamic";

/** Dados mínimos para abrir "Novo negócio" sem carregar a página Pipeline. */
export async function GET() {
  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const lastPipelineId = (await cookies()).get(PIPELINE_LAST_ID_COOKIE)?.value;

  return runWithTenant(access.organizationId, async () => {
    const [scope, pipelines, activeMembers, customFields, creditTypes, jobTitles] = await Promise.all([
      getSharedScope(access.organizationId, access.userId, access.role, "shareDeals"),
      prisma.pipeline.findMany({
        where: { organizationId: access.organizationId },
        orderBy: { order: "asc" },
        select: {
          id: true,
          name: true,
          isDefault: true,
          stages: { orderBy: { order: "asc" }, select: { id: true, name: true } },
        },
      }),
      prisma.organizationUser.findMany({
        where: { organizationId: access.organizationId, active: true },
        orderBy: { createdAt: "asc" },
        select: { userId: true, user: { select: { name: true } } },
      }),
      prisma.customFieldDefinition.findMany({
        where: { organizationId: access.organizationId, entityType: "DEAL" },
        orderBy: { order: "asc" },
        select: { id: true, label: true, type: true, options: true, required: true },
      }),
      prisma.creditType.findMany({
        where: { organizationId: access.organizationId },
        orderBy: { order: "asc" },
        select: { id: true, label: true },
      }),
      prisma.jobTitle.findMany({
        where: { organizationId: access.organizationId },
        orderBy: { order: "asc" },
        select: { id: true, label: true },
      }),
    ]);

    const members =
      scope.type === "owners"
        ? activeMembers.filter((member) => scope.ownerIds.includes(member.userId))
        : activeMembers;
    const defaultPipeline =
      pipelines.find((pipeline) => pipeline.id === lastPipelineId) ??
      pipelines.find((pipeline) => pipeline.isDefault) ??
      pipelines[0];

    return NextResponse.json(
      {
        defaultPipelineId: defaultPipeline?.id ?? null,
        pipelines: pipelines.map((pipeline) => ({
          id: pipeline.id,
          name: pipeline.name,
          stages: pipeline.stages,
        })),
        members: members.map((member) => ({ id: member.userId, name: member.user.name ?? "Sem nome" })),
        customFields,
        creditTypes,
        jobTitles,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
