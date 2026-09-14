import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import { recordCardEvent } from "@/lib/digital-cards/events";

export const dynamic = "force-dynamic";

/**
 * Abre uma sessão de apresentação — chamado quando o consultor abre "Meu QR
 * Code" pra mostrar ao cliente (ver
 * components/digital-card/use-presentation-session.ts). Só o DONO do
 * cartão apresenta o próprio (não faz sentido um gerente "apresentar" o
 * cartão de outra pessoa em nome dela).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const card = await prisma.digitalCard.findUnique({ where: { id } });
    if (!card || card.organizationId !== organizationId || card.userId !== userId) {
      return NextResponse.json({ error: "Cartão não encontrado" }, { status: 404 });
    }

    const presentation = await prisma.digitalCardPresentation.create({
      data: { organizationId, cardId: id, consultantUserId: userId },
    });

    recordCardEvent(organizationId, id, "QR_PRESENTED").catch(() => {});

    return NextResponse.json(presentation, { status: 201 });
  });
}
