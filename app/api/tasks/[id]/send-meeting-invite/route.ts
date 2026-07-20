import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import { getDealScope, scopeWhere } from "@/lib/team-scope";
import { sendWhatsAppMessageToContact, WhatsAppSendError } from "@/lib/whatsapp/send";
import { renderMeetingInviteMessage, buildMeetingInviteVariables } from "@/lib/meeting-invite";

export const dynamic = "force-dynamic";

/**
 * Manda o convite de reunião (texto + link "adicionar ao calendário", ver
 * lib/meeting-invite.ts) pro WhatsApp do cliente vinculado à tarefa — sempre
 * pelo número do RESPONSÁVEL da tarefa (task.ownerId), nunca de quem clicou
 * "Enviar" (pode ser um gerente ajudando, mas o cliente precisa continuar
 * falando com o vendedor de sempre). O texto vem pronto no corpo da
 * requisição (o que a pessoa via no preview no momento do clique), não é
 * relido do template salvo — evita qualquer corrida entre o autosave do
 * template e o envio.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { template } = (await req.json().catch(() => ({}))) as { template?: string };
  if (!template?.trim()) return NextResponse.json({ error: "Mensagem vazia" }, { status: 400 });

  const { session, organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const scope = await getDealScope(organizationId, userId, session!.user.role);
    const task = await prisma.task.findFirst({
      where: { id, organizationId, ...scopeWhere(scope) },
      include: { contact: true, owner: { select: { id: true, name: true } } },
    });
    if (!task) return NextResponse.json({ error: "Tarefa não encontrada" }, { status: 404 });
    if (task.type !== "MEETING") {
      return NextResponse.json({ error: "Só dá pra mandar convite em tarefas do tipo Reunião" }, { status: 400 });
    }
    if (!task.dueAt) return NextResponse.json({ error: "A reunião precisa de data/hora marcada" }, { status: 400 });
    if (!task.contact) return NextResponse.json({ error: "A reunião precisa de um cliente vinculado" }, { status: 400 });

    const vars = buildMeetingInviteVariables({
      contactName: task.contact.name,
      consultorName: task.owner.name,
      dueAt: task.dueAt,
      meetingTitle: task.title,
    });
    const message = renderMeetingInviteMessage(template, vars);

    try {
      await sendWhatsAppMessageToContact({
        organizationId,
        contactId: task.contact.id,
        ownerId: task.owner.id,
        text: message,
      });
    } catch (err) {
      if (err instanceof WhatsAppSendError) return NextResponse.json({ error: err.message }, { status: 400 });
      throw err;
    }

    await prisma.task.update({ where: { id: task.id }, data: { meetingInviteSentAt: new Date() } });

    return NextResponse.json({ ok: true });
  });
}
