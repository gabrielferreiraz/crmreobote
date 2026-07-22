import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { requireProcessAccess } from "@/lib/processes/access";
import { getOrCreateDefaultProcessPipeline } from "@/lib/processes/create";
import { ProcessStageManager } from "./process-stage-manager";

export default async function ProcessosSettingsPage() {
  const access = await requireProcessAccess();
  if (!access.ok || !access.isAdmin) redirect("/configuracoes");

  return runWithTenant(access.organizationId, async () => {
    const pipeline = await getOrCreateDefaultProcessPipeline(access.organizationId);
    const stages = await prisma.processStage.findMany({
      where: { pipelineId: pipeline.id },
      orderBy: { order: "asc" },
      include: { _count: { select: { processes: true } } },
    });

    return (
      <div className="max-w-2xl space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Etapas do Processos</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {pipeline.name} — etapas do Kanban de pós-venda. Marcar uma etapa como &quot;conclusão&quot; avisa o
            administrativo (push) sempre que um processo chegar nela.
          </p>
        </div>
        <ProcessStageManager pipelineId={pipeline.id} initialStages={stages} />
      </div>
    );
  });
}
