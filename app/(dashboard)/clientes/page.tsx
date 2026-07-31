import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { fetchContactsList, countContacts } from "@/lib/contacts/list-query";
import { getCurrentUserArea } from "@/lib/user-area";
import { ContactsTable } from "./contacts-table";
import { AdminClientsView } from "./admin-clients-view";

// Essa é só a 1ª página, no tamanho padrão do seletor de itens por página —
// abre a tela sem precisar de um fetch extra; paginação de verdade (ver
// contacts-table.tsx e GET /api/contacts) cuida do resto.
const DEFAULT_PAGE_SIZE = 50;

export default async function ClientesPage() {
  const area = await getCurrentUserArea();
  if (area === "ADMINISTRATIVO") return <AdminClientsView />;

  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const isOwner = session!.user.role === "OWNER";
  const isManager = ["OWNER", "MANAGER"].includes(session!.user.role ?? "");

  return runWithTenant(organizationId, async () => {
    const [contacts, totalCount, sources, jobTitles, customFields, membersRaw, pipelinesRaw] = await Promise.all([
      fetchContactsList({ organizationId, take: DEFAULT_PAGE_SIZE }),
      countContacts({ organizationId }),
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
          initialTotalCount={totalCount}
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
