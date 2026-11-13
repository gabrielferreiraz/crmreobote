import { NextResponse } from "next/server";
import { runWithTenant } from "@/lib/tenant-context";
import { getCurrentMembership } from "@/lib/current-membership";
import { requireRegistrationAccess } from "@/lib/deal-registration/access";
import { queryAudit } from "@/lib/audit-query";

export const dynamic = "force-dynamic";

/**
 * Histórico de auditoria de UMA venda (cadastro, cota, documentos, pedidos e
 * mudanças do negócio). Só quem trabalha no cadastro (Administrativo e Dono):
 * o consultor não vê a trilha, que mostra o que cada pessoa fez.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = await getCurrentMembership();
  if (!m) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(m.organizationId, async () => {
    const guard = await requireRegistrationAccess(id);
    if ("response" in guard) return guard.response;
    if (!guard.access.canBypass) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

    const cursor = new URL(req.url).searchParams.get("cursor") ?? undefined;
    const result = await queryAudit(guard.access.organizationId, { targetType: "Deal", targetId: id }, { cursor, limit: 50 });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  });
}
