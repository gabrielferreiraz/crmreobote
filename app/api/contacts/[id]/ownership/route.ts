import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { loadContactOwnership, buildConflictPayload } from "@/lib/contact-duplicate";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

/**
 * "De quem é este contato?" sem abrir a ficha inteira — usado onde um
 * consultor pode esbarrar num contato que não é dele sem ter passado por um
 * formulário de cadastro (ex.: criar negócio a partir de uma conversa de
 * WhatsApp já vinculada, ver QuickAddDealPanel). Mesmo payload do 409 de
 * duplicidade (ver lib/contact-duplicate.ts) — nome do responsável e se dá
 * pra assumir/solicitar, nunca histórico/atividades/negócios.
 *
 * Disponível pra qualquer sessão ativa (não só quem já é dono do contato) —
 * é exatamente o ponto: avisar quem NÃO é o dono.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const ownership = await loadContactOwnership(organizationId, id);
    if (!ownership) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    return NextResponse.json(buildConflictPayload(ownership, userId));
  });
}
