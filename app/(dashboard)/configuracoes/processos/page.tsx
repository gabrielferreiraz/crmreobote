import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { requireProcessAccess } from "@/lib/processes/access";
import { CategoryManager } from "./category-manager";

export default async function ProcessosSettingsPage() {
  const access = await requireProcessAccess();
  if (!access.ok || !access.isAdmin) redirect("/configuracoes");

  return runWithTenant(access.organizationId, async () => {
    const categories = await prisma.processCategory.findMany({
      where: { organizationId: access.organizationId },
      orderBy: { order: "asc" },
      include: {
        pipelines: {
          orderBy: { order: "asc" },
          include: {
            stages: { orderBy: { order: "asc" }, include: { _count: { select: { processes: true } } } },
            _count: { select: { processes: true } },
          },
        },
      },
    });

    return (
      <div className="max-w-3xl space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            Categorias de Processos
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Categoria → Subcategoria → Etapas do Kanban de pós-venda. Cada subcategoria tem suas próprias etapas —
            marcar uma etapa como &quot;conclusão&quot; avisa o consultor responsável (push) sempre que um processo
            chegar nela.
          </p>
        </div>
        <CategoryManager initialCategories={categories} />
      </div>
    );
  });
}
