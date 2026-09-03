import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { scopeWhere } from "@/lib/team-scope";
import { getSharedScope } from "@/lib/share-groups";
import { runWithTenant } from "@/lib/tenant-context";
import { recordUserChange } from "@/lib/user-activity";
import { getBrazilParts, brazilDateTimeStringToUTC, brazilDateKey } from "@/lib/timezone";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Generoso o bastante pra arrastar um dia inteiro de tarefas de uma vez
// (a grade só mostra 3 por dia + "+N mais", mas a seleção pode juntar
// vários dias) sem virar porta pra um script disparar update em massa à
// toa.
const MAX_TASKS_PER_MOVE = 200;

/**
 * Arrastar-e-soltar tarefa(s) pra outro dia na Agenda (ver
 * app/(dashboard)/agenda/task-calendar.tsx) — muda só o DIA, preservando o
 * mesmo horário de cada tarefa (uma tarefa às 14h continua às 14h no dia
 * novo). Aceita várias de uma vez (arrastar uma seleção inteira), cada
 * tarefa resolvida e auditada independente — uma tarefa fora do escopo de
 * quem pediu (ou já sem dueAt) é silenciosamente ignorada, nunca falha o
 * lote inteiro por causa de uma só.
 *
 * Mesmo padrão de auditoria de app/api/deals/[id]/move/route.ts: uma
 * Activity type=SYSTEM por tarefa MOVIDA de verdade (dealId/contactId da
 * própria tarefa, iguais ao padrão já usado em app/api/tasks/[id]/route.ts's
 * fluxo de remarcação) — é o que faz a movimentação aparecer na timeline do
 * negócio, pedido explícito.
 */
export async function PATCH(req: Request) {
  const body = await req.json();
  const { taskIds, newDate } = body as { taskIds?: string[]; newDate?: string };

  if (!Array.isArray(taskIds) || taskIds.length === 0) {
    return NextResponse.json({ error: "Selecione ao menos uma tarefa" }, { status: 400 });
  }
  if (taskIds.length > MAX_TASKS_PER_MOVE) {
    return NextResponse.json({ error: `Máximo de ${MAX_TASKS_PER_MOVE} tarefas por vez` }, { status: 400 });
  }
  if (!newDate || !DATE_RE.test(newDate)) {
    return NextResponse.json({ error: "Data inválida" }, { status: 400 });
  }

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { organizationId, userId } = access;

  return runWithTenant(organizationId, async () => {
    // Mesma regra colaborativa de PUT /api/tasks/[id]: quem compartilha a
    // agenda OU o negócio ligado já pode mover como coautor.
    const scope = await getSharedScope(organizationId, userId, access.role, ["shareAgenda", "shareDeals"]);
    const tasks = await prisma.task.findMany({
      where: {
        id: { in: Array.from(new Set(taskIds)) },
        organizationId,
        dueAt: { not: null },
        ...scopeWhere(scope),
      },
    });

    let moved = 0;
    for (const task of tasks) {
      const oldDateKey = brazilDateKey(task.dueAt!);
      if (oldDateKey === newDate) continue; // já está no dia de destino — nada a fazer

      const { hour, minute } = getBrazilParts(task.dueAt!);
      const timeStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      const newDueAt = brazilDateTimeStringToUTC(newDate, timeStr);

      await prisma.task.update({ where: { id: task.id }, data: { dueAt: newDueAt } });

      if (task.dealId || task.contactId) {
        const oldDateLabel = new Date(task.dueAt!).toLocaleDateString("pt-BR");
        const newDateLabel = newDueAt.toLocaleDateString("pt-BR");
        await prisma.activity.create({
          data: {
            organizationId,
            dealId: task.dealId,
            contactId: task.contactId,
            userId,
            type: "SYSTEM",
            body: `arrastou a tarefa "${task.title}" de ${oldDateLabel} para ${newDateLabel}`,
          },
        });
      }
      moved += 1;
    }

    if (moved > 0) {
      recordUserChange(organizationId, userId).catch((err) =>
        console.error("[user-activity] falha ao registrar alteração", err),
      );
    }

    return NextResponse.json({ moved, skipped: taskIds.length - moved });
  });
}
