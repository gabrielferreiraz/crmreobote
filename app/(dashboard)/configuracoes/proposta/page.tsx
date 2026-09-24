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
      <div className="mx-auto max-w-lg space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Modelo de proposta</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Texto que já vem preenchido no campo &ldquo;Descrição&rdquo; de toda proposta nova — o consultor pode editar na
            hora. Mudar aqui vale só pras próximas propostas: as que já foram criadas mantêm o texto que tinham.
          </p>
        </div>
        <ProposalTemplateForm initial={org?.defaultProposalDescription ?? ""} />
      </div>
    );
  });
}
