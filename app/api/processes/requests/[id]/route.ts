import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireProcessAccess } from "@/lib/processes/access";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

/**
 * Marca a solicitação como resolvida. Quem resolve depende da direção (ver
 * schema.prisma, ProcessRequest.targetUserId): sem alvo (consultor avisou o
 * administrativo, de sempre) só administrativo resolve; com alvo
 * (administrativo mandou um modelo pro consultor, ver "Enviar modelo") só
 * aquele consultor específico resolve — o Dono/administrativo também pode,
 * por via das dúvidas (ex.: fechar por ele).
 */
export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireProcessAccess();
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const existing = await prisma.processRequest.findFirst({ where: { id, organizationId: access.organizationId } });
    if (!existing) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });

    const canResolve = access.isAdmin || existing.targetUserId === access.userId;
    if (!canResolve) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    if (existing.resolvedAt) return NextResponse.json({ error: "Já resolvida" }, { status: 409 });

    const updated = await prisma.processRequest.update({
      where: { id },
      data: { resolvedAt: new Date(), resolvedById: access.userId },
      include: { requestedBy: { select: { id: true, name: true } }, resolvedBy: { select: { id: true, name: true } } },
    });

    return NextResponse.json(updated);
  });
}
