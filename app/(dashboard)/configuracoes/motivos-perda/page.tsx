import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ReasonManager } from "./reason-manager";

export default async function LossReasonsSettingsPage() {
  const session = await auth();
  if (!session?.user.role || !["OWNER", "MANAGER"].includes(session.user.role)) {
    redirect("/configuracoes");
  }

  const organizationId = session.user.organizationId!;

  return runWithTenant(organizationId, async () => {
    const reasons = await prisma.lossReason.findMany({
      where: { organizationId },
      orderBy: { order: "asc" },
      include: { _count: { select: { deals: true } } },
    });

    return (
      <div className="max-w-lg space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Motivos de perda</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Usados ao marcar um negócio como perdido
          </p>
        </div>
        <ReasonManager initialReasons={reasons} />
      </div>
    );
  });
}
