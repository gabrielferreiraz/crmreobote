import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { FieldManager } from "./field-manager";

export default async function CustomFieldsSettingsPage() {
  const session = await auth();
  if (!session?.user.role || !["OWNER", "MANAGER"].includes(session.user.role)) {
    redirect("/configuracoes");
  }

  const organizationId = session.user.organizationId!;

  return runWithTenant(organizationId, async () => {
    const fields = await prisma.customFieldDefinition.findMany({
      where: { organizationId },
      orderBy: [{ entityType: "asc" }, { order: "asc" }],
    });

    return (
      <div className="max-w-lg space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            Campos personalizados
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Adicione campos extras a Clientes e Negócios
          </p>
        </div>
        <FieldManager initialFields={fields} />
      </div>
    );
  });
}
