import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { scopeWhere } from "@/lib/team-scope";
import { getSharedScope } from "@/lib/share-groups";
import { runWithTenant } from "@/lib/tenant-context";
import { recordUserChange } from "@/lib/user-activity";
import { recordUndoableAction } from "@/lib/undo/record";
import type { BulkUpdatePayload } from "@/lib/undo/types";

export const dynamic = "force-dynamic";

// Mesmo teto de app/api/tasks/bulk-move/route.ts — seleção múltipla na
// grade do mês nunca junta mais que isso de uma vez.
const MAX_TASKS_PER_COMPLETE = 200;

/**
 * Concluir várias tarefas da Agenda de uma vez (seleção múltipla da grade
 * do mês, ver "Selecionar" + menu do botão direito em task-calendar.tsx).
 * Mesma regra de app/api/deals/bulk (action "completeTasks"), só que a
 * seleção aqui já é de TAREFAS (não de negócios — a Agenda tem tarefa sem
 * negócio nenhum, só com contato ou solta).
 *
 * Videochamada/Visita ficam de fora: só concluem com um resultado (ver
 * PATCH /api/tasks/[id], "Informe o resultado da videochamada/visita antes
 * de concluir") que esta ação em massa não pergunta — continuam pendentes
 * e entram no `skipped`.
 */
export async function PATCH(req: Request) {
  const body = await req.json();
  const { taskIds } = body as { taskIds?: string[] };

  if (!Array.isArray(taskIds) || taskIds.length === 0) {
    return NextResponse.json({ error: "Selecione ao menos uma tarefa" }, { status: 400 });
  }
  if (taskIds.length > MAX_TASKS_PER_COMPLETE) {
    return NextResponse.json({ error: `Máximo de ${MAX_TASKS_PER_COMPLETE} tarefas por vez` }, { status: 400 });
  }

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { organizationId, userId } = access;

  return runWithTenant(organizationId, async () => {
    // Mesma regra colaborativa de PUT /api/tasks/[id] e PATCH bulk-move:
    // quem compartilha a agenda OU o negócio ligado já pode concluir como
    // coautor.
    const scope = await getSharedScope(organizationId, userId, access.role, ["shareAgenda", "shareDeals"]);
    const tasks = await prisma.task.findMany({
      where: {
        id: { in: Array.from(new Set(taskIds)) },
        organizationId,
        completedAt: null,
        ...scopeWhere(scope),
      },
      select: { id: true, title: true, type: true, dealId: true, contactId: true },
    });

    if (tasks.length === 0) {
      return NextResponse.json({ error: "Nenhuma tarefa pendente entre as selecionadas." }, { status: 404 });
    }

    const completable = tasks.filter((t) => t.type !== "VIDEO_CALL" && t.type !== "VISIT");
    const skipped = tasks.length - completable.length;
    const skippedReason = skipped > 0 ? "Videochamada e Visita concluem com o resultado da tarefa — abra cada uma." : null;
    if (completable.length === 0) {
      return NextResponse.json({ completed: 0, skipped, skippedReason });
    }

    const ids = completable.map((t) => t.id);
    await prisma.task.updateMany({ where: { id: { in: ids } }, data: { completedAt: new Date() } });

    // Uma Activity por tarefa concluída que está ligada a negócio/contato —
    // mesmo padrão de PATCH /api/tasks/bulk-move (é o que faz a conclusão
    // aparecer na timeline do negócio).
    const withLink = completable.filter((t) => t.dealId || t.contactId);
    if (withLink.length > 0) {
      await prisma.activity.createMany({
        data: withLink.map((t) => ({
          organizationId,
          dealId: t.dealId,
          contactId: t.contactId,
          userId,
          type: "SYSTEM" as const,
          body: `concluiu a tarefa "${t.title}" (ação em massa)`,
        })),
      });
    }

    const label = completable.length === 1 ? "1 tarefa concluída" : `${completable.length} tarefas concluídas`;
    const afterRevert =
      completable.length === 1 ? "1 tarefa voltou a ficar pendente" : `${completable.length} tarefas voltaram a ficar pendentes`;
    const undo = await recordUndoableAction({
      organizationId,
      userId,
      type: "deal.bulkUpdate",
      description: label,
      payload: {
        groups: [{ model: "task", previousValues: { completedAt: null }, entityIds: ids }],
        descriptions: { afterRevert, original: label },
      } satisfies BulkUpdatePayload,
    });

    recordUserChange(organizationId, userId).catch((err) => console.error("[user-activity] falha ao registrar alteração", err));

    return NextResponse.json({ completed: completable.length, skipped, skippedReason, undo });
  });
}
