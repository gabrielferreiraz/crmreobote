import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { CreditTypeManager } from "./credit-type-manager";

export default async function CreditTypesSettingsPage() {
  const session = await auth();
  if (!session?.user.role || !["OWNER", "MANAGER"].includes(session.user.role)) {
    redirect("/configuracoes");
  }

  const organizationId = session.user.organizationId!;

  return runWithTenant(organizationId, async () => {
    const creditTypes = await prisma.creditType.findMany({
      where: { organizationId },
      orderBy: { order: "asc" },
    });

    const counts = await prisma.deal.groupBy({
      by: ["creditType"],
      where: { organizationId, creditType: { not: null } },
      _count: { _all: true },
    });
    const countByCreditType = new Map(counts.map((c) => [c.creditType, c._count._all]));

    return (
      <div className="max-w-lg space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            Tipos de crédito
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Aparece no campo &quot;Tipo de crédito&quot; ao criar ou editar um negócio
          </p>
        </div>
        <CreditTypeManager
          initialCreditTypes={creditTypes.map((c) => ({ ...c, dealCount: countByCreditType.get(c.label) ?? 0 }))}
        />
      </div>
    );
  });
}
