import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import type { CustomFieldFormValues } from "@/components/custom-fields-fieldset";
import { getCurrentUserArea } from "@/lib/user-area";
import { ContactsTable } from "./contacts-table";
import { AdminClientsView } from "./admin-clients-view";

export default async function ClientesPage() {
  const area = await getCurrentUserArea();
  if (area === "ADMINISTRATIVO") return <AdminClientsView />;

  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const isOwner = session!.user.role === "OWNER";
  const isManager = ["OWNER", "MANAGER"].includes(session!.user.role ?? "");

  return runWithTenant(organizationId, async () => {
    const [contactsRaw, totalCount, sources, jobTitles, customFields, membersRaw, pipelinesRaw] = await Promise.all([
      // Só a 1ª página (ver PAGE_SIZE em contacts-table.tsx, que "carrega
      // mais" sob demanda) — uma organização com 100 mil clientes nunca
      // baixa a tabela inteira só pra abrir a tela.
      prisma.contact.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { deals: true } }, responsavel: { select: { id: true, name: true } } },
        take: 500,
      }),
      prisma.contact.count({ where: { organizationId } }),
      prisma.leadSource.findMany({ where: { organizationId }, orderBy: { order: "asc" } }),
      prisma.jobTitle.findMany({ where: { organizationId }, orderBy: { order: "asc" } }),
      prisma.customFieldDefinition.findMany({
        where: { organizationId, entityType: "CONTACT" },
        orderBy: { order: "asc" },
      }),
      prisma.organizationUser.findMany({
        where: { organizationId, active: true },
        orderBy: { createdAt: "asc" },
        include: { user: { select: { id: true, name: true } } },
      }),
      prisma.pipeline.findMany({
        where: { organizationId },
        orderBy: { order: "asc" },
        include: { stages: { orderBy: { order: "asc" }, take: 1 } },
      }),
    ]);

    const contacts = contactsRaw.map((c) => ({
      ...c,
      customFieldValues: c.customFieldValues as CustomFieldFormValues | null,
    }));
    const members = membersRaw.map((m) => m.user);
    const pipelines = pipelinesRaw
      .filter((p) => p.stages.length > 0)
      .map((p) => ({ id: p.id, name: p.name, isDefault: p.isDefault, firstStageId: p.stages[0].id }));

    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Clientes</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {totalCount} conta{totalCount === 1 ? "" : "s"} ativa{totalCount === 1 ? "" : "s"} na sua carteira
          </p>
        </div>
        <ContactsTable
          initialContacts={contacts}
          totalCount={totalCount}
          isOwner={isOwner}
          isManager={isManager}
          sources={sources}
          jobTitles={jobTitles}
          members={members}
          pipelines={pipelines}
          customFields={customFields}
        />
      </div>
    );
  });
}
