import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Copy, Lock } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { canManageScript } from "@/lib/campaigns/scripts";
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

    // Script da equipe criado por outra pessoa: só leitura pra Supervisor/
    // Consultor (ver canManageScript). Explica e oferece o caminho certo —
    // duplicar e editar a própria cópia — em vez de abrir um formulário que o
    // servidor recusaria ao salvar.
    if (!canManageScript(script, { userId, role: session!.user.role })) {
      return (
        <div className="mx-auto max-w-lg space-y-4">
          <Link
            href={campaignId ? `/whatsapp/campanhas/${campaignId}` : "/whatsapp/scripts"}
            className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
            {campaignId ? "Campanha" : "Scripts"}
          </Link>
          <div className="card space-y-3 p-5">
            <p className="flex items-center gap-2 text-sm font-medium text-neutral-900 dark:text-neutral-100">
              <Lock className="h-4 w-4 text-neutral-400" strokeWidth={2} />
              &ldquo;{script.name}&rdquo; é um script da equipe
            </p>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Você pode usá-lo nas suas campanhas e conversas, mas só quem criou, um gerente ou o dono podem alterar o
              texto. Para ajustar do seu jeito, crie uma cópia sua.
            </p>
            <Link href={`/whatsapp/scripts/novo?duplicate=${script.id}`} className="btn-primary">
              <Copy className="h-4 w-4" strokeWidth={2} />
              Duplicar para editar
            </Link>
          </div>
        </div>
      );
    }

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
