import { NextResponse } from "next/server";
import { prisma, prismaRaw } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant, setTenantOnTx } from "@/lib/tenant-context";
import { notifyLeadRequestResolved } from "@/lib/lead-requests/notify";

export const dynamic = "force-dynamic";

/**
 * Aprova ou recusa um pedido de lead (ver POST /api/lead-requests) — só o
 * DONO do lead no momento do pedido (LeadRequest.ownerId) pode resolver,
 * mesmo que o contato já tenha mudado de responsável por outro caminho
 * nesse meio-tempo (nesse caso raro, aprovar ainda reatribui pro
 * requester — é o que o dono que está resolvendo decidiu, não cabe a esta
 * rota adivinhar se ainda faz sentido).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { action } = (await req.json()) as { action?: "approve" | "decline" };
  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (action !== "approve" && action !== "decline") {
    return NextResponse.json({ error: "action precisa ser 'approve' ou 'decline'" }, { status: 400 });
  }

  return runWithTenant(organizationId, async () => {
    const request = await prisma.leadRequest.findFirst({
      where: { id, organizationId },
      include: { contact: { select: { id: true, name: true } }, requester: { select: { id: true, name: true } } },
    });
    if (!request) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    if (request.ownerId !== userId) {
      return NextResponse.json({ error: "Só quem recebeu o pedido pode aprovar ou recusar" }, { status: 403 });
    }
    if (request.status !== "PENDING") {
      return NextResponse.json({ error: "Este pedido já foi resolvido" }, { status: 400 });
    }

    // Pra quem o contato vai se aprovado — normalmente o próprio requester,
    // mas pode ser outra pessoa (ver assigneeId em prisma/schema.prisma:
    // admin/assistente que pediu EM NOME de alguém, ex.: importação de
    // planilha "pro Fulano"). `?? requesterId` cobre linha antiga, de antes
    // deste campo existir.
    const newOwnerId = request.assigneeId ?? request.requesterId;

    if (action === "approve") {
      // prismaRaw.$transaction + setTenantOnTx (não prisma.$transaction, nem
      // a forma em array) — mesmo padrão/motivo de POST /api/lead-requests.
      await prismaRaw.$transaction(async (tx) => {
        await setTenantOnTx(tx, organizationId);
        await tx.contact.update({ where: { id: request.contactId }, data: { responsavelId: newOwnerId } });
        await tx.leadRequest.update({
          where: { id },
          data: { status: "APPROVED", resolvedAt: new Date(), resolvedById: userId },
        });
      });
    } else {
      await prisma.leadRequest.update({
        where: { id },
        data: { status: "DECLINED", resolvedAt: new Date(), resolvedById: userId },
      });
    }

    notifyLeadRequestResolved({
      contactId: request.contact.id,
      contactName: request.contact.name,
      requesterId: request.requester.id,
      assigneeId: request.assigneeId,
      approved: action === "approve",
    }).catch((err) => console.error("[lead-requests] falha ao notificar resolução", err));

    return NextResponse.json({ ok: true });
  });
}
