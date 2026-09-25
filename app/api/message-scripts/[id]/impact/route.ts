import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { getDealScope } from "@/lib/team-scope";
import { canAccessScript } from "@/lib/campaigns/scripts";
import { getScriptImpact } from "@/lib/campaigns/script-sync";

export const dynamic = "force-dynamic";

/**
 * "O que acontece se eu editar este script?" — chamado pelo editor ANTES de
 * salvar, só pra decidir se precisa perguntar algo (ver script-save-dialog.tsx):
 *  - hasHistory: já foi enviado a alguém → vale perguntar "correção ou nova versão";
 *  - campaigns: campanhas ativas (rascunho/rodando/pausada) que usam o script E
 *    que quem pede enxerga, com quantos destinatários ainda vão receber.
 * Só leitura, nunca altera nada.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const script = await prisma.messageScript.findFirst({
      where: { id, organizationId: access.organizationId },
      select: { id: true, visibility: true, createdById: true, version: true },
    });
    if (!script || !canAccessScript(script, access)) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const scope = await getDealScope(access.organizationId, access.userId, access.role);
    return NextResponse.json(await getScriptImpact(access.organizationId, scope, id, script.version));
  });
}
