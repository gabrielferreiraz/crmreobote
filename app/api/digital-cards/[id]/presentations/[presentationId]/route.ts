import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import { recordCardEvent } from "@/lib/digital-cards/events";
import type { $Enums } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

const VALID_RESPONSES = new Set(["ACCESSED", "REFUSED", "SELF_VIEW"]);

/**
 * Resposta do consultor à pergunta pós-apresentação ("O cliente acessou seu
 * cartão?" — ver components/digital-card/use-presentation-session.ts).
 * `automaticAccessDetected` é calculado AQUI, na hora de responder — houve
 * algum CARD_VIEW deste cartão entre o início da apresentação e agora? É só
 * uma DICA mostrada na pergunta (ver GET abaixo), nunca a resposta em si:
 * quem decide consultantResponse é sempre o consultor.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; presentationId: string }> }) {
  const { id, presentationId } = await params;
  const body = await req.json();
  const { response } = body as { response?: string };

  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  if (!response || !VALID_RESPONSES.has(response)) {
    return NextResponse.json({ error: "Resposta inválida" }, { status: 400 });
  }

  return runWithTenant(organizationId, async () => {
    const presentation = await prisma.digitalCardPresentation.findUnique({ where: { id: presentationId } });
    if (!presentation || presentation.cardId !== id || presentation.consultantUserId !== userId) {
      return NextResponse.json({ error: "Apresentação não encontrada" }, { status: 404 });
    }

    const accessDuring = await prisma.digitalCardEvent.findFirst({
      where: { cardId: id, eventType: "CARD_VIEW", createdAt: { gte: presentation.startedAt } },
      select: { id: true },
    });

    const updated = await prisma.digitalCardPresentation.update({
      where: { id: presentationId },
      data: {
        consultantResponse: response as $Enums.PresentationResponse,
        automaticAccessDetected: !!accessDuring,
        endedAt: new Date(),
      },
    });

    if (response === "ACCESSED") recordCardEvent(organizationId, id, "CLIENT_ACCESSED").catch(() => {});
    if (response === "REFUSED") recordCardEvent(organizationId, id, "CLIENT_REFUSED").catch(() => {});

    return NextResponse.json(updated);
  });
}

/** Consultado pelo hook de apresentação pra mostrar a DICA ("Detectamos um acesso — foi o cliente?") antes de perguntar. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; presentationId: string }> }) {
  const { id, presentationId } = await params;

  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const presentation = await prisma.digitalCardPresentation.findUnique({ where: { id: presentationId } });
    if (!presentation || presentation.cardId !== id || presentation.consultantUserId !== userId) {
      return NextResponse.json({ error: "Apresentação não encontrada" }, { status: 404 });
    }

    const accessDuring = await prisma.digitalCardEvent.findFirst({
      where: { cardId: id, eventType: "CARD_VIEW", createdAt: { gte: presentation.startedAt } },
      select: { id: true },
    });

    return NextResponse.json({ likelyAccessed: !!accessDuring });
  });
}
