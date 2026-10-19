import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import { canReadCentralThread, getCentralAccess } from "@/lib/whatsapp/central-access";
import { CentralLeadError, closeCentralLead } from "@/lib/whatsapp/lead-routing";
import { publishWhatsAppEvent } from "@/lib/whatsapp/live-events";

/**
 * Concluir um atendimento da Central. O responsável continua gravado: se o
 * cliente escrever de novo, a conversa reabre com a mesma pessoa.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;
  const { session, organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const access = await getCentralAccess(organizationId, userId, session!.user.role);
    const thread = await prisma.whatsAppThread.findFirst({
      where: { id: threadId, organizationId },
      select: { assigneeId: true, inboxStatus: true },
    });
    if (!thread?.inboxStatus) return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
    if (!canReadCentralThread(access, thread)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    if (thread.inboxStatus === "CLOSED") return NextResponse.json({ ok: true });

    try {
      await closeCentralLead({ organizationId, threadId });
    } catch (error) {
      if (error instanceof CentralLeadError) return NextResponse.json({ error: error.message }, { status: 409 });
      console.error(`[wa:central] falha ao concluir thread=${threadId}`, error);
      return NextResponse.json({ error: "Não foi possível concluir. Tente de novo." }, { status: 500 });
    }
    publishWhatsAppEvent(organizationId, { type: "message", threadId, central: true });
    return NextResponse.json({ ok: true });
  });
}
