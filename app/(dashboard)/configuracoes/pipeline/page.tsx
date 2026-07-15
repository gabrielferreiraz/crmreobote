import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { PipelineManager } from "./pipeline-manager";

export default async function PipelineSettingsPage() {
  const session = await auth();
  if (!session?.user.role || !["OWNER", "MANAGER"].includes(session.user.role)) {
    redirect("/configuracoes");
  }

  const organizationId = session.user.organizationId!;

  return runWithTenant(organizationId, async () => {
    const pipelines = await prisma.pipeline.findMany({
      where: { organizationId },
      orderBy: { order: "asc" },
      include: {
        stages: {
          orderBy: { order: "asc" },
          include: { _count: { select: { deals: true } } },
        },
        _count: { select: { deals: true } },
      },
    });

    return (
      <div className="max-w-2xl space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Pipelines</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Crie quantas pipelines precisar, cada uma com suas próprias etapas.
          </p>
        </div>
        <PipelineManager initialPipelines={pipelines} isOwner={session.user.role === "OWNER"} />
      </div>
    );
  });
}
