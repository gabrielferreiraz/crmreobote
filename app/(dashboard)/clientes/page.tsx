import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { fetchContactsList, countContacts } from "@/lib/contacts/list-query";
import { getCurrentUserArea } from "@/lib/user-area";
import { getCurrentMembership } from "@/lib/current-membership";
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
    // Mesma régua de GET /api/contacts (isMember → só os PRÓPRIOS contatos,
    // nunca a carteira toda) — reconfere no banco via getCurrentMembership(),
    // não confia só no `role` do JWT (pode estar desatualizado até o próximo
    // login). Faltava aqui: a 1ª renderização (esta função) buscava a
    // organização INTEIRA pra qualquer papel, inclusive Consultor — o
    // client-side (contacts-table.tsx) só corrigia depois que a pessoa
    // mexesse em algum filtro (só ele bate no GET /api/contacts, que já
    // aplicava a restrição certa). Até lá, um Consultor via a carteira de
    // TODOS os outros consultores na 1ª tela — achado em 2026-09.
    const membership = await getCurrentMembership();
    const isMember = membership?.role === "MEMBER";
    const effectiveResponsavelId = isMember ? session!.user.id : undefined;

    const [contacts, totalCount, sources, jobTitles, customFields, membersRaw, pipelinesRaw] = await Promise.all([
      fetchContactsList({ organizationId, responsavelId: effectiveResponsavelId, take: DEFAULT_PAGE_SIZE }),
      countContacts({ organizationId, responsavelId: effectiveResponsavelId }),
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
      <ContactsTable
        initialContacts={contacts}
        initialTotalCount={totalCount}
        isOwner={isOwner}
        isManager={isManager}
        sources={sources}
        jobTitles={jobTitles}
        members={members}
        currentUserId={session!.user.id}
        pipelines={pipelines}
        customFields={customFields}
      />
    );
  });
}
