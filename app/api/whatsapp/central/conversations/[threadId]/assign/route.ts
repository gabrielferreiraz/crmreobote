import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { bodyErrorResponse, readJson } from "@/lib/read-body";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import { canReadCentralThread, canTransferCentralThread, getCentralAccess } from "@/lib/whatsapp/central-access";
import { assignCentralLead, CentralLeadError } from "@/lib/whatsapp/lead-routing";
import { publishWhatsAppEvent } from "@/lib/whatsapp/live-events";

/** Assumir (assigneeId = eu) ou transferir uma conversa da Central. */
export async function POST(request: Request, { params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;
  const { session, organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  let body: { assigneeId?: unknown };
  try {
    body = await readJson(request) as { assigneeId?: unknown };
  } catch (error) {
    return bodyErrorResponse(error) ?? NextResponse.json({ error: "Corpo inválido" }, { status: 400 });
  }
  if (typeof body.assigneeId !== "string" || !body.assigneeId) {
    return NextResponse.json({ error: "Escolha um atendente" }, { status: 400 });
  }
  const assigneeId = body.assigneeId;

  return runWithTenant(organizationId, async () => {
    const access = await getCentralAccess(organizationId, userId, session!.user.role);
    const thread = await prisma.whatsAppThread.findFirst({
      where: { id: threadId, organizationId },
      select: { assigneeId: true, inboxStatus: true, customName: true, whatsappName: true, contact: { select: { name: true } } },
    });
    if (!thread?.inboxStatus) return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
    if (!canReadCentralThread(access, thread) || !canTransferCentralThread(access, assigneeId)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    if (thread.assigneeId === assigneeId && thread.inboxStatus === "OPEN") {
      return NextResponse.json({ assigneeId, contactOwnershipBlocked: false });
    }

    try {
      const result = await assignCentralLead({
        organizationId,
        threadId,
        assigneeId,
        actorUserId: userId,
        source: assigneeId === userId && !thread.assigneeId ? "MANUAL_CLAIM" : "MANUAL_TRANSFER",
      });
      publishWhatsAppEvent(organizationId, { type: "message", threadId, central: true });

      // Quem recebeu por transferência precisa saber na hora (quem assumiu sozinho já sabe).
      if (assigneeId !== userId) {
        const name = thread.contact?.name || thread.customName || thread.whatsappName || "Cliente";
        sendPushToUser(assigneeId, {
          title: "Conversa transferida para você",
          body: name,
          url: `/whatsapp/central?c=${threadId}`,
        }).catch((err) => console.error("[wa:central] falha ao avisar transferência", err));
      }
      return NextResponse.json(result);
    } catch (error) {
      if (error instanceof CentralLeadError) return NextResponse.json({ error: error.message }, { status: 409 });
      console.error(`[wa:central] falha ao atribuir thread=${threadId}`, error);
      return NextResponse.json({ error: "Não foi possível atribuir. Tente de novo." }, { status: 500 });
    }
  });
}
