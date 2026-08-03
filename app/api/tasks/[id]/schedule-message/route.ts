import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import { getDealScope, scopeWhere } from "@/lib/team-scope";

export const dynamic = "force-dynamic";

/**
 * Salva o texto da mensagem que o cron (lib/tasks/scheduled-whatsapp.ts) vai
 * mandar sozinho pro WhatsApp do contato no dueAt da tarefa — não envia
 * nada aqui, só grava (diferente de send-meeting-invite/route.ts, que manda
 * na hora). Chamado uma única vez, na criação da tarefa (ver
 * components/schedule-message-dialog.tsx); não existe edição depois.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { message } = (await req.json().catch(() => ({}))) as { message?: string };
  if (!message?.trim()) return NextResponse.json({ error: "Mensagem vazia" }, { status: 400 });

  const { session, organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const scope = await getDealScope(organizationId, userId, session!.user.role);
    const task = await prisma.task.findFirst({ where: { id, organizationId, ...scopeWhere(scope) } });
    if (!task) return NextResponse.json({ error: "Tarefa não encontrada" }, { status: 404 });
    if (task.type !== "WHATSAPP") {
      return NextResponse.json({ error: "Só dá pra programar mensagem em tarefas do tipo WhatsApp" }, { status: 400 });
    }
    if (!task.dueAt || task.dueAt <= new Date()) {
      return NextResponse.json({ error: "A tarefa precisa de um prazo futuro" }, { status: 400 });
    }
    if (!task.contactId) {
      return NextResponse.json({ error: "A tarefa precisa de um cliente vinculado" }, { status: 400 });
    }

    await prisma.task.update({ where: { id: task.id }, data: { scheduledMessageText: message } });
    return NextResponse.json({ ok: true });
  });
}
