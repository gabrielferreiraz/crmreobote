import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ScriptsTable } from "./scripts-table";

export default async function ScriptsPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const isManager = session!.user.role === "OWNER" || session!.user.role === "ADMIN";

  return runWithTenant(organizationId, async () => {
    if (!isManager) {
      return (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Apenas donos e administradores podem gerenciar scripts.
        </p>
      );
    }

    const scriptsRaw = await prisma.messageScript.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      include: { createdBy: { select: { name: true } } },
    });

    return (
      <div className="space-y-4">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Mensagens reutilizáveis pras campanhas — escreva uma vez, use em quantas campanhas quiser.
        </p>
        <ScriptsTable
          initialScripts={scriptsRaw.map((s) => ({
            id: s.id,
            name: s.name,
            text: s.text,
            createdByName: s.createdBy.name,
            createdAt: s.createdAt.toISOString(),
          }))}
        />
      </div>
    );
  });
}
