import { getTvConfig } from "@/lib/tv-dashboard";
import { requireSession } from "@/lib/require-session";
import { getCurrentMembership } from "@/lib/current-membership";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { redirect } from "next/navigation";
import { TvConfigForm } from "./tv-config-form";
import { TvDisplayLinkManager } from "./tv-display-link-manager";

export default async function TvConfigPage() {
  const { organizationId } = await requireSession();
  if (!organizationId) {
    redirect("/login");
  }

  // Link público (ver tv-display-link-manager.tsx) só aparece pra
  // OWNER/MANAGER — mesmo nível de acesso que /api/tv-display-link já exige
  // pra gerar/revogar; esconder a seção pra quem não pode usá-la evita um
  // "Sem permissão" só de olhar a própria tela de configuração.
  const membership = await getCurrentMembership();
  const canManageDisplayLink = membership?.role === "OWNER" || membership?.role === "MANAGER";

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
  const [config, stagesRaw, displayLink] = await Promise.all([
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
    canManageDisplayLink
      ? runWithTenant(organizationId, () =>
          prisma.tvDisplayLink.findFirst({
            where: { organizationId, revokedAt: null },
            orderBy: { createdAt: "desc" },
            include: { createdBy: { select: { name: true } } },
          }),
        )
      : Promise.resolve(null),
  ]);
  const stages = stagesRaw.map((s) => ({ id: s.id, name: s.name, pipelineName: s.pipeline.name }));

  return (
    <div className="space-y-8">
      <TvConfigForm
        initialAdsUrls={config.adsUrls}
        initialVisibleWidgets={config.visibleWidgets}
        initialSelectedStageIds={config.selectedStageIds}
        allStages={stages}
      />
      {canManageDisplayLink && (
        <TvDisplayLinkManager
          initialLink={
            displayLink && {
              id: displayLink.id,
              tokenPrefix: displayLink.tokenPrefix,
              createdByName: displayLink.createdBy.name,
              lastUsedAt: displayLink.lastUsedAt?.toISOString() ?? null,
              createdAt: displayLink.createdAt.toISOString(),
            }
          }
        />
      )}
    </div>
  );
}
