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

    // TvDashboardConfig tem RLS (ver migração
    // 20260812090000_tv_dashboard_config_rls) — sem este wrap, a policy
    // nunca via app.current_organization_id definido e o upsert falhava
    // em silêncio. Mesma 2ª camada de proteção que o resto do app usa, não
    // só o `where`/`create` acima.
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
