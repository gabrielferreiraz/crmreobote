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

  return runWithTenant(organizationId, async () => {
    const [allScripts, duplicateFrom] = await Promise.all([
      prisma.messageScript.findMany({ where: { organizationId }, select: { tags: true } }),
      duplicate
        ? prisma.messageScript.findFirst({
            where: { id: duplicate, organizationId },
            select: { name: true, steps: true, tags: true },
          })
        : Promise.resolve(null),
    ]);

    const existingTags = Array.from(new Set(allScripts.flatMap((s) => s.tags))).sort();

    return (
      <ScriptEditor
        initialName={duplicateFrom ? `${duplicateFrom.name} (cópia)` : undefined}
        initialSteps={duplicateFrom ? (duplicateFrom.steps as { text: string; delayAfterSec: number }[]) : undefined}
        initialTags={duplicateFrom?.tags}
        existingTags={existingTags}
        {...(returnTo
          ? { redirectTo: returnTo, backLabel: "Envio em massa", defaultStepDelayRange: [10, 25] as [number, number] }
          : {})}
      />
    );
  });
}
