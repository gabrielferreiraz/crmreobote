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
    const jobTitles = await prisma.jobTitle.findMany({
      where: { organizationId },
      orderBy: { order: "asc" },
    });

    const counts = await prisma.contact.groupBy({
      by: ["jobTitle"],
      where: { organizationId, jobTitle: { not: null } },
      _count: { _all: true },
    });
    const countByJobTitle = new Map(counts.map((c) => [c.jobTitle, c._count._all]));

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
