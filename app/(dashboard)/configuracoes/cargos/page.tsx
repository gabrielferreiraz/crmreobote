import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { JobTitleManager } from "./job-title-manager";

export default async function JobTitlesSettingsPage() {
  const session = await auth();
  if (!session?.user.role || !["OWNER", "MANAGER"].includes(session.user.role)) {
    redirect("/configuracoes");
  }

  const organizationId = session.user.organizationId!;

  return runWithTenant(organizationId, async () => {
    // As 2 abaixo não dependem uma da outra — rodavam em sequência sem
    // motivo. `contact.groupBy` sozinho já dá tudo que a autocura precisa
    // (o conjunto de cargos distintos em uso, via as chaves do agrupamento)
    // — antes havia uma 3ª consulta (`contact.findMany` com `distinct`) só
    // pra achar esse mesmo conjunto, e ela sozinha custava ~1-2,5s (medido):
    // o `distinct` do Prisma nesse formato busca as ~18 mil linhas com cargo
    // preenchido e deduplica no Node, em vez de empurrar isso pro SQL — o
    // `EXPLAIN` do SQL equivalente mostrou ~44ms, então o custo real estava
    // na camada Prisma/transferência, não no banco. Eliminada, não só
    // reordenada: groupBy já faz o trabalho de sobra.
    const [jobTitlesInitial, countsInitial] = await Promise.all([
      prisma.jobTitle.findMany({
        where: { organizationId },
        orderBy: { order: "asc" },
      }),
      prisma.contact.groupBy({
        by: ["jobTitle"],
        where: { organizationId, jobTitle: { not: null } },
        _count: { _all: true },
      }),
    ]);

    let jobTitles = jobTitlesInitial;
    const existingLabels = new Set(jobTitles.map((j) => j.label));
    // Cargo digitado fora daqui (migração do Agendor, importação em massa,
    // upsert de integração externa) nunca passou por "+ Adicionar" — sem
    // isso, ficava invisível nesta lista pra sempre, mesmo com contatos
    // usando. Autocura: toda visita aqui garante que todo valor distinto
    // realmente em uso também exista como opção editável.
    const missing = countsInitial
      .map((c) => c.jobTitle)
      .filter((label): label is string => !!label && !existingLabels.has(label));
    if (missing.length > 0) {
      const maxOrder = await prisma.jobTitle.aggregate({ where: { organizationId }, _max: { order: true } });
      await prisma.jobTitle.createMany({
        data: missing.map((label, i) => ({ organizationId, label, order: (maxOrder._max.order ?? -1) + 1 + i })),
      });
      jobTitles = await prisma.jobTitle.findMany({ where: { organizationId }, orderBy: { order: "asc" } });
    }

    const countByJobTitle = new Map(countsInitial.map((c) => [c.jobTitle, c._count._all]));

    return (
      <div className="max-w-lg space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Cargos</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Aparece no campo &quot;Cargo&quot; ao cadastrar ou editar um cliente
          </p>
        </div>
        <JobTitleManager
          initialJobTitles={jobTitles.map((j) => ({ ...j, contactCount: countByJobTitle.get(j.label) ?? 0 }))}
        />
      </div>
    );
  });
}
