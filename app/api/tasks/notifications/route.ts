import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import { brazilDateKey, brazilEndOfDayUTC } from "@/lib/timezone";

export const dynamic = "force-dynamic";

export async function GET() {
  const { organizationId, userId } = await requireSession();
  if (!organizationId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const now = new Date();
    // Antes filtrava só `dueAt <= now` (atrasada de verdade) — uma tarefa
    // marcada pra hoje mais tarde (ex.: reunião às 18h, checado às 10h) nunca
    // aparecia no sino, mesmo o painel se chamando "Tarefas atrasadas/hoje".
    // Estende o teto até o fim do dia civil de Brasília; `overdue` (abaixo)
    // é quem de fato diferencia "já passou" de "ainda hoje" pra UI agrupar.
    const endOfToday = brazilEndOfDayUTC(brazilDateKey(now));

    const tasks = await prisma.task.findMany({
      where: {
        organizationId,
        ownerId: userId,
        completedAt: null,
        dueAt: { lte: endOfToday },
      },
      orderBy: { dueAt: "asc" },
      select: {
        id: true,
        type: true,
        title: true,
        dueAt: true,
        deal: { select: { id: true, name: true } },
        contact: { select: { id: true, name: true } },
      },
    });

    const result = tasks.map((t) => ({ ...t, overdue: !!t.dueAt && t.dueAt < now }));
    return NextResponse.json(result);
  });
}
