import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import { getDealScope } from "@/lib/team-scope";
import { listConversations } from "@/lib/whatsapp/conversations";

export const dynamic = "force-dynamic";

// Chamada pelo polling client-side da tela de Conversas (ver
// app/(dashboard)/conversas/conversations-view.tsx) pra manter a lista
// atualizada sem recarregar a página inteira.
export async function GET() {
  const { session, organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const scope = await getDealScope(organizationId, userId, session!.user.role);
    const conversations = await listConversations(organizationId, scope);
    return NextResponse.json(conversations);
  });
}
