"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";

export async function saveTvConfig({
  adsUrls,
  selectedStageIds,
  visibleWidgets,
}: {
  adsUrls: string[];
  selectedStageIds: string[];
  visibleWidgets: string[];
}) {
  try {
    const { organizationId } = await requireSession();
    if (!organizationId) throw new Error("Unauthorized");

    // TvDashboardConfig hoje não tem RLS (ver migração nova que adiciona),
    // então isso funcionava mesmo sem o wrap — mas fica consistente com o
    // resto do app (2ª camada de proteção, não só o `where`/`create` acima)
    // e já blinda o dia em que a policy for adicionada.
    await runWithTenant(organizationId, () =>
      prisma.tvDashboardConfig.upsert({
        where: { organizationId },
        update: {
          adsUrls,
          selectedStageIds,
          visibleWidgets,
        },
        create: {
          organizationId,
          adsUrls,
          selectedStageIds,
          visibleWidgets,
        },
      }),
    );

    return { success: true };
  } catch (error) {
    console.error("[saveTvConfig] Error:", error);
    return { success: false, error: "Falha ao salvar as configurações." };
  }
}
