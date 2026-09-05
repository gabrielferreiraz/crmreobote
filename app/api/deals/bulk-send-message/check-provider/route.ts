import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { scopeWhere } from "@/lib/team-scope";
import { getSharedScope } from "@/lib/share-groups";
import { runWithTenant } from "@/lib/tenant-context";
import { resolvePreferredInstancesByOwner } from "@/lib/whatsapp/send";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"] as const;
const MAX_DEALS_PER_SEND = 2000; // mesmo teto de POST /api/deals/bulk-send-message

/**
 * Só responde "algum desses negócios vai mandar por um número Evolution (QR
 * Code)?" — usado por BulkSendMessageDialog/BulkSendConversationsDialog pra
 * decidir se mostra o aviso de risco de banimento ANTES de disparar de
 * verdade.
 *
 * Existe separado do envio de verdade (POST /api/deals/bulk-send-message)
 * porque aqui o risco depende do DONO de cada negócio, não do WhatsApp de
 * quem está fazendo o envio em massa — cada negócio manda pelo número do
 * PRÓPRIO dono (ver CampaignRecipient.instanceId no schema). Um Gerente/
 * Supervisor/Dono disparando pra negócios de vários consultores pode ter o
 * próprio número na Meta (sem risco) enquanto um dos consultores da seleção
 * ainda usa Evolution (risco de verdade) — checar só o WhatsApp de quem
 * está logado (como useMyWhatsappProvider faz pros outros 2 fluxos de
 * disparo, onde o remetente É sempre quem está logado) dava a resposta
 * errada bem aqui, o único caso em que o remetente varia por destinatário.
 */
export async function POST(req: Request) {
  const body = await req.json();
  const { dealIds } = body as { dealIds?: string[] };

  const access = await requireRole([...ALLOWED_ROLES]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { organizationId, userId, role } = access;

  if (!Array.isArray(dealIds) || dealIds.length === 0) {
    return NextResponse.json({ hasEvolutionInstance: false });
  }
  if (dealIds.length > MAX_DEALS_PER_SEND) {
    return NextResponse.json({ error: `Máximo de ${MAX_DEALS_PER_SEND} negócios por envio` }, { status: 400 });
  }

  return runWithTenant(organizationId, async () => {
    // Mesma revalidação de escopo do envio de verdade — nunca confia na
    // seleção vinda do cliente, mesmo pra uma checagem só de leitura.
    const scope = await getSharedScope(organizationId, userId, role, "shareDeals");
    const deals = await prisma.deal.findMany({
      where: { id: { in: dealIds }, organizationId, ...scopeWhere(scope) },
      select: { owner: { select: { id: true } } },
    });

    const ownerIds = Array.from(new Set(deals.map((d) => d.owner.id)));
    const instanceByOwnerId = await resolvePreferredInstancesByOwner(organizationId, ownerIds);
    const hasEvolutionInstance = Array.from(instanceByOwnerId.values()).some((i) => i.provider === "EVOLUTION");

    return NextResponse.json({ hasEvolutionInstance });
  });
}
