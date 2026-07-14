import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ScriptEditor } from "../script-editor";

export default async function NovoScriptPage({
  searchParams,
}: {
  searchParams: Promise<{ duplicate?: string }>;
}) {
  const { duplicate } = await searchParams;
  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const isManager = session!.user.role === "OWNER" || session!.user.role === "ADMIN";

  return runWithTenant(organizationId, async () => {
    if (!isManager) {
      return (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Apenas donos e administradores podem gerenciar scripts.
        </p>
      );
    }

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
      />
    );
  });
}
