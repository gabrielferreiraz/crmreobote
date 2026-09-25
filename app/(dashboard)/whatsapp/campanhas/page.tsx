import { TriangleAlert } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { listCampaigns } from "@/lib/campaigns/list";
import { getCronStaleness, CAMPAIGNS_CRON_NAME, CAMPAIGNS_CRON_MAX_STALE_MINUTES } from "@/lib/cron-watchdog";
import { getDealScope } from "@/lib/team-scope";
import { CampaignsTable } from "./campaigns-table";

export default async function CampanhasPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const userId = session!.user.id;
  const isOwner = session!.user.role === "OWNER";

  return runWithTenant(organizationId, async () => {
    // Escopo por papel (ver lib/team-scope.ts) — mesma correção do GET
    // /api/campaigns: Consultor só vê as próprias campanhas, não a
    // organização inteira.
    const scope = await getDealScope(organizationId, userId, session!.user.role);
    const [campaigns, instancesRaw, scriptsRaw] = await Promise.all([
      listCampaigns(organizationId, scope),
      prisma.whatsAppInstance.findMany({
        where: { organizationId, status: "CONNECTED" },
        include: { user: { select: { id: true, name: true } } },
      }),
      // Picker de script na criação de campanha respeita a mesma
      // visibilidade da biblioteca (ver app/(dashboard)/whatsapp/scripts/page.tsx).
      prisma.messageScript.findMany({
        where: { organizationId, ...(isOwner ? {} : { OR: [{ visibility: "PUBLIC" }, { createdById: userId }] }) },
        orderBy: { name: "asc" },
      }),
    ]);

    // Só checa quando existe alguma campanha rodando de verdade — sem isso a
    // consulta ao CronRun (barata, mas desnecessária) rodaria em toda visita
    // à tela, mesmo sem nenhum envio automático em jogo pra avisar sobre.
    const hasRunningCampaign = campaigns.some((c) => c.status === "RUNNING");
    const cronStatus = hasRunningCampaign
      ? await getCronStaleness(CAMPAIGNS_CRON_NAME, CAMPAIGNS_CRON_MAX_STALE_MINUTES)
      : null;

    return (
      <div className="space-y-4">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Envie a mesma mensagem para várias pessoas, uma por vez, com um intervalo entre cada envio.
        </p>
        {cronStatus?.stale && (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-500/10 dark:text-amber-300">
            <TriangleAlert className="h-4 w-4 shrink-0" strokeWidth={2} />
            <span>
              <strong>Envio automático parado</strong> — o disparador de campanhas não roda{" "}
              {cronStatus.minutesSinceLastRun === null
                ? "há muito tempo"
                : `há ${Math.round(cronStatus.minutesSinceLastRun)} min`}{" "}
              (esperado a cada 1-2min). Campanhas com gente pendente não vão sair sozinhas até isso ser resolvido —
              avise quem administra o sistema.
            </span>
          </div>
        )}
        <CampaignsTable
          initialCampaigns={campaigns.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() }))}
          instances={instancesRaw.map((i) => ({ id: i.id, label: i.user.name }))}
          scripts={scriptsRaw.map((s) => ({
            id: s.id,
            name: s.name,
            steps: s.steps as { text: string; delayAfterSec: number }[],
          }))}
        />
      </div>
    );
  });
}
