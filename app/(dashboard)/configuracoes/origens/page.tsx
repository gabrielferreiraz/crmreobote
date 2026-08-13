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
    // As 2 abaixo não dependem uma da outra — rodavam em sequência sem
    // motivo. Igual à correção em cargos/page.tsx: `contact.groupBy` sozinho
    // já dá o conjunto de origens distintas em uso (via as chaves do
    // agrupamento) — a 3ª consulta que existia antes só pra achar isso
    // (`contact.findMany` com `distinct`) custava ~1-2,5s sozinha (medido em
    // cargos/page.tsx, mesmo formato de consulta): o `distinct` do Prisma
    // nesse formato busca as linhas com origem preenchida e deduplica no
    // Node em vez de empurrar isso pro SQL. Eliminada, não só reordenada.
    const [sourcesInitial, counts] = await Promise.all([
      prisma.leadSource.findMany({
        where: { organizationId },
        orderBy: { order: "asc" },
      }),
      prisma.contact.groupBy({
        by: ["source"],
        where: { organizationId, source: { not: null } },
        _count: { _all: true },
      }),
    ]);

    let sources = sourcesInitial;
    const existingLabels = new Set(sources.map((s) => s.label));
    // Mesma autocura de cargos/page.tsx: origem digitada fora daqui
    // (migração, importação, integração externa) nunca passou por "+
    // Adicionar" — sem isso ficava invisível aqui mesmo com contatos usando.
    const missing = counts
      .map((c) => c.source)
      .filter((label): label is string => !!label && !existingLabels.has(label));
    if (missing.length > 0) {
      const maxOrder = await prisma.leadSource.aggregate({ where: { organizationId }, _max: { order: true } });
      await prisma.leadSource.createMany({
        data: missing.map((label, i) => ({ organizationId, label, order: (maxOrder._max.order ?? -1) + 1 + i })),
      });
      sources = await prisma.leadSource.findMany({ where: { organizationId }, orderBy: { order: "asc" } });
    }

    const countBySource = new Map(counts.map((c) => [c.source, c._count._all]));

    return (
      <div className="max-w-lg space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Origens</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            De onde vêm os leads — aparece no campo "Origem" ao cadastrar um cliente. Marcar uma origem como
            "Conta como anúncio" faz todo contato com ela (novo ou antigo) entrar no relatório de Facebook/Instagram,
            mesmo sem ter vindo pelo formulário nativo — ver aba Facebook em Relatórios.
          </p>
        </div>
        <SourceManager
          initialSources={sources.map((s) => ({ ...s, contactCount: countBySource.get(s.label) ?? 0 }))}
        />
      </div>
    );
  });
}
