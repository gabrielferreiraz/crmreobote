import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { listCampaigns } from "@/lib/campaigns/list";
import { CampaignsTable } from "./campaigns-table";

export default async function CampanhasPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const isManager = session!.user.role === "OWNER" || session!.user.role === "ADMIN";

  return runWithTenant(organizationId, async () => {
    if (!isManager) {
      return (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Apenas donos e administradores podem gerenciar campanhas.
        </p>
      );
    }

    const [campaigns, instancesRaw, scriptsRaw] = await Promise.all([
      listCampaigns(organizationId),
      prisma.whatsAppInstance.findMany({
        where: { organizationId, status: "CONNECTED" },
        include: { user: { select: { id: true, name: true } } },
      }),
      prisma.messageScript.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
    ]);

    return (
      <div className="space-y-4">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Prospecção em massa por WhatsApp — variação de mensagem e intervalo seguro entre envios.
        </p>
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
