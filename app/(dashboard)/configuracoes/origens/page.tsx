import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { SourceManager } from "./source-manager";

export default async function LeadSourcesSettingsPage() {
  const session = await auth();
  if (!session?.user.role || !["OWNER", "MANAGER"].includes(session.user.role)) {
    redirect("/configuracoes");
  }

  const organizationId = session.user.organizationId!;

  return runWithTenant(organizationId, async () => {
    let sources = await prisma.leadSource.findMany({
      where: { organizationId },
      orderBy: { order: "asc" },
    });

    // Mesma autocura de cargos/page.tsx: origem digitada fora daqui
    // (migração, importação, integração externa) nunca passou por "+
    // Adicionar" — sem isso ficava invisível aqui mesmo com contatos usando.
    const distinctUsed = await prisma.contact.findMany({
      where: { organizationId, source: { not: null } },
      distinct: ["source"],
      select: { source: true },
    });
    const existingLabels = new Set(sources.map((s) => s.label));
    const missing = distinctUsed
      .map((d) => d.source)
      .filter((label): label is string => !!label && !existingLabels.has(label));
    if (missing.length > 0) {
      const maxOrder = await prisma.leadSource.aggregate({ where: { organizationId }, _max: { order: true } });
      await prisma.leadSource.createMany({
        data: missing.map((label, i) => ({ organizationId, label, order: (maxOrder._max.order ?? -1) + 1 + i })),
      });
      sources = await prisma.leadSource.findMany({ where: { organizationId }, orderBy: { order: "asc" } });
    }

    const counts = await prisma.contact.groupBy({
      by: ["source"],
      where: { organizationId, source: { not: null } },
      _count: { _all: true },
    });
    const countBySource = new Map(counts.map((c) => [c.source, c._count._all]));

    return (
      <div className="max-w-lg space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Origens</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            De onde vêm os leads — aparece no campo "Origem" ao cadastrar um cliente
          </p>
        </div>
        <SourceManager
          initialSources={sources.map((s) => ({ ...s, contactCount: countBySource.get(s.label) ?? 0 }))}
        />
      </div>
    );
  });
}
