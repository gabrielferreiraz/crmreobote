import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireProcessAccess } from "@/lib/processes/access";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

/** Marca a solicitação como resolvida — só administrativo. */
export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireProcessAccess();
  if (!access.ok || !access.isAdmin) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const existing = await prisma.processRequest.findFirst({ where: { id, organizationId: access.organizationId } });
    if (!existing) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
    if (existing.resolvedAt) return NextResponse.json({ error: "Já resolvida" }, { status: 409 });

    const updated = await prisma.processRequest.update({
      where: { id },
      data: { resolvedAt: new Date(), resolvedById: access.userId },
      include: { requestedBy: { select: { id: true, name: true } }, resolvedBy: { select: { id: true, name: true } } },
    });

    return NextResponse.json(updated);
  });
}
