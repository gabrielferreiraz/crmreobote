import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { BusinessHoursForm } from "./business-hours-form";

export default async function BusinessHoursSettingsPage() {
  const session = await auth();
  if (!session?.user.role || !["OWNER", "MANAGER"].includes(session.user.role)) {
    redirect("/configuracoes");
  }

  const organizationId = session.user.organizationId!;

  return runWithTenant(organizationId, async () => {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { businessHours: true },
    });

    return (
      <div className="mx-auto max-w-lg space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            Horário de atendimento
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Janela única pra organização inteira — usada pelo gatilho de automação
            &quot;Mensagem recebida&quot; (ex.: responder só fora do expediente, ou só durante).
          </p>
        </div>
        <BusinessHoursForm
          initial={organization?.businessHours as { start: string; end: string; days: number[]; holidays: string[] } | null}
        />
      </div>
    );
  });
}
