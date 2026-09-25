import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ScriptEditor } from "../script-editor";

export default async function EditScriptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ campanha?: string | string[] }>;
}) {
  const { id } = await params;
  const { campanha } = await searchParams;
  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const userId = session!.user.id;
  const isOwner = session!.user.role === "OWNER";

  // Veio do painel "Scripts desta campanha" (?campanha=<id>): salvar/cancelar
  // volta pra lá, e o diálogo de salvar já vem com essa campanha marcada. Só
  // aceita id "cuid-like" — o valor vira segmento de caminho no redirect.
  const campaignId = typeof campanha === "string" && /^[a-z0-9]{10,40}$/i.test(campanha) ? campanha : undefined;

  return runWithTenant(organizationId, async () => {
    const [script, allScripts] = await Promise.all([
      prisma.messageScript.findFirst({ where: { id, organizationId } }),
      // Restrita (PRIVATE) não entra nem na lista de tags sugeridas de quem
      // não pode vê-la — mesma regra de visibilidade aplicada em todo lugar.
      prisma.messageScript.findMany({
        where: { organizationId, ...(isOwner ? {} : { OR: [{ visibility: "PUBLIC" }, { createdById: userId }] }) },
        select: { tags: true },
      }),
    ]);
    // Restrita (PRIVATE) só edita quem criou ou o OWNER — mesma regra de
    // app/api/message-scripts/[id]/route.ts.
    if (!script || (script.visibility === "PRIVATE" && script.createdById !== userId && !isOwner)) notFound();

    const existingTags = Array.from(new Set(allScripts.flatMap((s) => s.tags))).sort();

    return (
      <ScriptEditor
        scriptId={script.id}
        initialName={script.name}
        initialSteps={script.steps as { text: string; delayAfterSec: number }[]}
        initialTags={script.tags}
        initialVisibility={script.visibility}
        existingTags={existingTags}
        campaignId={campaignId}
        redirectTo={campaignId ? `/whatsapp/campanhas/${campaignId}` : undefined}
        backLabel={campaignId ? "Campanha" : undefined}
      />
    );
  });
}
