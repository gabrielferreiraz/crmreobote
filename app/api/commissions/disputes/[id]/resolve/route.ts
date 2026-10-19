import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { requireCommissionManager, auditCommission, badRequest, commissionRoute } from "@/lib/commissions/route-helpers";
import { notifyDisputeResolved } from "@/lib/commissions/notify";

export const dynamic = "force-dynamic";

/** Responder (e fechar) uma contestação — a resposta volta pro consultor no celular e na linha da parcela. */
export const POST = commissionRoute(async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireCommissionManager();
  if ("error" in guard) return guard.error;
  const { access } = guard;

  const body = (await req.json().catch(() => ({}))) as { response?: unknown };
  const response = typeof body.response === "string" ? body.response.trim().slice(0, 500) : "";
  if (!response) return badRequest("Escreva a resposta — é o que o consultor vai ler");

  return runWithTenant(access.organizationId, async () => {
    const dispute = await prisma.commissionDispute.findFirst({
      where: { id, organizationId: access.organizationId },
      select: { requesterId: true, requester: { select: { name: true } }, entry: { select: { sale: { select: { clientName: true } } } } },
    });
    if (!dispute) return NextResponse.json({ error: "Contestação não encontrada" }, { status: 404 });

    const { count } = await prisma.commissionDispute.updateMany({
      where: { id, status: "OPEN" },
      data: { status: "RESOLVED", response, resolvedById: access.userId, resolvedAt: new Date() },
    });
    if (count === 0) return NextResponse.json({ error: "Essa contestação já foi respondida" }, { status: 409 });

    await auditCommission(req, access, "COMMISSION_DISPUTE_RESOLVED", {
      targetType: "CommissionDispute",
      targetId: id,
      detail: `${dispute.requester.name}${dispute.entry.sale ? ` · ${dispute.entry.sale.clientName}` : ""} · "${response}"`,
    });
    after(() => notifyDisputeResolved(dispute.requesterId, response));
    return NextResponse.json({ ok: true });
  });
});
