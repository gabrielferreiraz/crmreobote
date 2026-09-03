import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { getScriptUsageMap } from "@/lib/campaigns/scripts";
import { ScriptsTable } from "./scripts-table";

export default async function ScriptsPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const userId = session!.user.id;
  const isOwner = session!.user.role === "OWNER";

  return runWithTenant(organizationId, async () => {
    const [scriptsRaw, usageMap] = await Promise.all([
      prisma.messageScript.findMany({
        // Restrita (PRIVATE) só aparece pra quem criou ou pro OWNER — Pública,
        // pra organização inteira, como sempre foi (ver mesma regra em
        // app/api/message-scripts/route.ts).
        where: { organizationId, ...(isOwner ? {} : { OR: [{ visibility: "PUBLIC" }, { createdById: userId }] }) },
        orderBy: { createdAt: "desc" },
        include: { createdBy: { select: { name: true } } },
      }),
      getScriptUsageMap(organizationId),
    ]);

    return (
      <div className="space-y-4">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Mensagens reutilizáveis pras campanhas — escreva uma vez, use em quantas campanhas quiser.
        </p>
        <ScriptsTable
          currentUserId={userId}
          initialScripts={scriptsRaw.map((s) => ({
            id: s.id,
            name: s.name,
            steps: s.steps as { text: string; delayAfterSec: number }[],
            tags: s.tags,
            visibility: s.visibility,
            createdById: s.createdById,
            createdByName: s.createdBy.name,
            createdAt: s.createdAt.toISOString(),
            usage: usageMap.get(s.id) ?? [],
          }))}
        />
      </div>
    );
  });
}
