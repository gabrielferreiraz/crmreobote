import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ScriptEditor } from "../script-editor";

export default async function NovoScriptPage({
  searchParams,
}: {
  searchParams: Promise<{ duplicate?: string; returnTo?: string }>;
}) {
  const { duplicate, returnTo } = await searchParams;
  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const userId = session!.user.id;
  const isOwner = session!.user.role === "OWNER";

  return runWithTenant(organizationId, async () => {
    const [allScripts, duplicateFrom] = await Promise.all([
      // Restrita (PRIVATE) não entra na lista de tags sugeridas de quem não
      // pode vê-la — mesma regra de visibilidade aplicada em todo lugar.
      prisma.messageScript.findMany({
        where: { organizationId, ...(isOwner ? {} : { OR: [{ visibility: "PUBLIC" }, { createdById: userId }] }) },
        select: { tags: true },
      }),
      duplicate
        ? prisma.messageScript.findFirst({
            where: { id: duplicate, organizationId },
            select: { name: true, steps: true, tags: true, visibility: true, createdById: true },
          })
        : Promise.resolve(null),
    ]);
    // Só duplica um script Restrito (PRIVATE) quem criou ou o OWNER — mesma
    // regra de acesso do resto da biblioteca.
    if (duplicateFrom?.visibility === "PRIVATE" && duplicateFrom.createdById !== userId && !isOwner) {
      notFound();
    }

    const existingTags = Array.from(new Set(allScripts.flatMap((s) => s.tags))).sort();

    return (
      <ScriptEditor
        initialName={duplicateFrom ? `${duplicateFrom.name} (cópia)` : undefined}
        initialSteps={duplicateFrom ? (duplicateFrom.steps as { text: string; delayAfterSec: number }[]) : undefined}
        initialTags={duplicateFrom?.tags}
        initialVisibility={duplicateFrom?.visibility}
        existingTags={existingTags}
        {...(returnTo
          ? { redirectTo: returnTo, backLabel: "Envio em massa", defaultStepDelayRange: [10, 25] as [number, number] }
          : {})}
      />
    );
  });
}
