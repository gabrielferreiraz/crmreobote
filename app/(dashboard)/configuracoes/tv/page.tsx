import { getTvConfig } from "@/lib/tv-dashboard";
import { requireSession } from "@/lib/require-session";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { redirect } from "next/navigation";
import { TvConfigForm } from "./tv-config-form";

export default async function TvConfigPage() {
  const { organizationId } = await requireSession();
  if (!organizationId) {
    redirect("/login");
  }

  // getTvConfig já abre o próprio runWithTenant por dentro — as duas não
  // dependem uma da outra, então não precisam esperar em fila.
  //
  // PipelineStage tem RLS forçada (via join com Pipeline.organizationId) —
  // sem runWithTenant aqui, a policy nunca via app.current_organization_id
  // definido e devolvia zero etapas em silêncio ("Nenhuma etapa encontrada"
  // mesmo com etapas de verdade cadastradas).
  //
  // Traz o nome do funil junto e ordena por ele primeiro — organização com
  // mais de um funil tem etapa de mesmo nome repetida em cada um (ex.:
  // "Prospecção" em 5 funis diferentes); sem o nome do funil pra agrupar,
  // a lista de seleção fica ambígua (qual "Prospecção" é qual?).
  const [config, stagesRaw] = await Promise.all([
    getTvConfig(organizationId),
    runWithTenant(organizationId, () =>
      prisma.pipelineStage.findMany({
        where: {
          pipeline: {
            organizationId,
          }
        },
        select: { id: true, name: true, pipeline: { select: { name: true } } },
        orderBy: [{ pipeline: { order: "asc" } }, { order: "asc" }],
      }),
    ),
  ]);
  const stages = stagesRaw.map((s) => ({ id: s.id, name: s.name, pipelineName: s.pipeline.name }));

  return (
    <TvConfigForm
      initialAdsUrls={config.adsUrls}
      initialVisibleWidgets={config.visibleWidgets}
      initialSelectedStageIds={config.selectedStageIds}
      allStages={stages}
    />
  );
}
