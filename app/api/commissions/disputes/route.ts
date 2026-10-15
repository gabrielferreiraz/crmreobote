import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { getCommissionAccess } from "@/lib/commissions/access";
import { badRequest } from "@/lib/commissions/route-helpers";
import { notifyDisputeOpened } from "@/lib/commissions/notify";

export const dynamic = "force-dynamic";

/**
 * "Esse valor está errado?" — qualquer pessoa contesta uma parcela DELA
 * (nunca de outra pessoa), de venda já conferida ou ajuste. Uma contestação
 * aberta por parcela de cada vez: contestar de novo antes da resposta só
 * duplicaria o aviso pro Financeiro.
 */
export async function POST(req: Request) {
  const access = await getCommissionAccess();
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { entryId?: unknown; message?: unknown } | null;
  if (!body || typeof body.entryId !== "string") return badRequest("Parcela inválida");
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 500) : "";
  if (!message) return badRequest("Conte o que está errado");
  const entryId = body.entryId;

  return runWithTenant(access.organizationId, async () => {
    const entry = await prisma.commissionEntry.findFirst({
      where: {
        id: entryId,
        organizationId: access.organizationId,
        beneficiaryId: access.userId,
        status: { not: "CANCELLED" },
        OR: [{ saleId: null }, { sale: { status: "ACTIVE" } }],
      },
      select: { id: true, sale: { select: { clientName: true } }, disputes: { where: { status: "OPEN" }, select: { id: true } } },
    });
    if (!entry) return NextResponse.json({ error: "Parcela não encontrada" }, { status: 404 });
    if (entry.disputes.length > 0) return NextResponse.json({ error: "Você já contestou esta parcela — aguarde a resposta" }, { status: 409 });

    const dispute = await prisma.commissionDispute.create({
      data: { organizationId: access.organizationId, entryId, requesterId: access.userId, message },
      select: { id: true },
    });
    after(() => notifyDisputeOpened(access.organizationId, access.actorName, entry.sale?.clientName ?? null));
    return NextResponse.json(dispute, { status: 201 });
  });
}
