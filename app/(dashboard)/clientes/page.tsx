import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ContactsTable } from "./contacts-table";

export default async function ClientesPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const isOwner = session!.user.role === "OWNER";

  return runWithTenant(organizationId, async () => {
    const contacts = await prisma.contact.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { deals: true } } },
    });

    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Clientes</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {contacts.length} conta{contacts.length === 1 ? "" : "s"} ativa{contacts.length === 1 ? "" : "s"} na sua carteira
          </p>
        </div>
        <ContactsTable initialContacts={contacts} isOwner={isOwner} />
      </div>
    );
  });
}
