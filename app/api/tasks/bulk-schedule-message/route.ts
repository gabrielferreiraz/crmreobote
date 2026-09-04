import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { getDealScope, scopeWhere } from "@/lib/team-scope";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"] as const;
const MAX_TASKS = 200;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { taskIds, message } = body as { taskIds?: string[]; message?: string };

  if (!Array.isArray(taskIds) || taskIds.length === 0) {
    return NextResponse.json({ error: "Nenhuma tarefa selecionada" }, { status: 400 });
  }
  if (taskIds.length > MAX_TASKS) {
    return NextResponse.json(
      { error: `Máximo de ${MAX_TASKS} tarefas por vez` },
      { status: 400 },
    );
  }
  if (!message?.trim()) {
    return NextResponse.json({ error: "Mensagem vazia" }, { status: 400 });
  }

  const access = await requireRole([...ALLOWED_ROLES]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { organizationId, userId, role } = access;

  return runWithTenant(organizationId, async () => {
    const scope = await getDealScope(organizationId, userId, role);
    const tasks = await prisma.task.findMany({
      where: {
        id: { in: taskIds },
        organizationId,
        ...scopeWhere(scope),
        type: "WHATSAPP",
        completedAt: null,
        contactId: { not: null },
        dueAt: { gt: new Date() },
      },
      select: { id: true },
    });

    if (tasks.length === 0) {
      return NextResponse.json(
        { error: "Nenhuma tarefa WhatsApp válida com prazo futuro e cliente vinculado" },
        { status: 400 },
      );
    }

    await prisma.task.updateMany({
      where: { id: { in: tasks.map((t) => t.id) }, organizationId },
      data: { scheduledMessageText: message.trim() },
    });

    return NextResponse.json({ saved: tasks.length, skipped: taskIds.length - tasks.length });
  });
}
