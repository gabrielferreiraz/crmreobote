import { NextResponse } from "next/server";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { getDealScope } from "@/lib/team-scope";
import { syncCampaignFromLibrary } from "@/lib/campaigns/script-sync";

export const dynamic = "force-dynamic";

/**
 * "Usar a versão da biblioteca" — copia texto + versão ATUAIS do(s) script(s)
 * da biblioteca pra cópia desta campanha (que só existe pra campanha ativa:
 * rascunho/rodando/pausada). Corpo opcional `{ scriptId }` restringe a um
 * script; sem ele, sincroniza todos os que estão diferentes. O texto novo vale
 * já no próximo envio (o motor relê a campanha a cada envio).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const scriptId = typeof (body as { scriptId?: unknown }).scriptId === "string" ? (body as { scriptId: string }).scriptId : undefined;

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    // Mesmo escopo por papel de todas as rotas de campanha (campaignScopeWhere,
    // aplicado dentro de syncCampaignFromLibrary) — fora do escopo é 404.
    const scope = await getDealScope(access.organizationId, access.userId, access.role);
    const result = await syncCampaignFromLibrary(
      { organizationId: access.organizationId, userId: access.userId, role: access.role, scope },
      id,
      scriptId,
    );
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ syncedScriptIds: result.syncedScriptIds, skippedScriptIds: result.skippedScriptIds });
  });
}
