import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ScriptEditor } from "../script-editor";

export default async function EditScriptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

    const [script, allScripts] = await Promise.all([
      prisma.messageScript.findFirst({ where: { id, organizationId } }),
      prisma.messageScript.findMany({ where: { organizationId }, select: { tags: true } }),
    ]);
    if (!script) notFound();

    const existingTags = Array.from(new Set(allScripts.flatMap((s) => s.tags))).sort();

    return (
      <ScriptEditor
        scriptId={script.id}
        initialName={script.name}
        initialSteps={script.steps as { text: string; delayAfterSec: number }[]}
        initialTags={script.tags}
        existingTags={existingTags}
      />
    );
  });
}
