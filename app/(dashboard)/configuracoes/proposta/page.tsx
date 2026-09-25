import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ProposalTemplateForm } from "./proposal-template-form";

export default async function ProposalSettingsPage() {
  const session = await auth();
  if (session?.user.role !== "OWNER") {
    redirect("/configuracoes");
  }

  const organizationId = session.user.organizationId!;

  return runWithTenant(organizationId, async () => {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { defaultProposalDescription: true },
    });

    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-5 dark:border-neutral-800 dark:bg-neutral-900/50">
          <p className="text-xs font-semibold tracking-wide text-brand uppercase">Propostas comerciais</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Texto padrão da proposta</h1>
          <p className="mt-2 max-w-2xl text-sm text-neutral-500 dark:text-neutral-400">
            Este texto entra automaticamente no campo Descrição quando o consultor cria uma proposta nova. Ele ainda pode
            ajustar antes de gerar o documento; propostas já criadas não mudam quando você altera este modelo.
          </p>
        </div>
        <ProposalTemplateForm initial={org?.defaultProposalDescription ?? ""} />
      </div>
    );
  });
}
