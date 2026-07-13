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
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Campanhas</h1>
          </div>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Apenas donos e administradores podem gerenciar campanhas.
          </p>
        </div>
      );
    }

    const [campaigns, instancesRaw] = await Promise.all([
      listCampaigns(organizationId),
      prisma.whatsAppInstance.findMany({
        where: { organizationId, status: "CONNECTED" },
        include: { user: { select: { id: true, name: true } } },
      }),
    ]);

    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Campanhas</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Prospecção em massa por WhatsApp — variação de mensagem e intervalo seguro entre envios.
          </p>
        </div>
        <CampaignsTable
          initialCampaigns={campaigns.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() }))}
          instances={instancesRaw.map((i) => ({ id: i.id, label: i.user.name }))}
        />
      </div>
    );
  });
}
