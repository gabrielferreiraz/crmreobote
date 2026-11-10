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
    // marcada pra hoje mais tarde (ex.: videochamada às 18h, checado às 10h) nunca
    // aparecia no sino, mesmo o painel se chamando "Tarefas atrasadas/hoje".
    // Estende o teto até o fim do dia civil de Brasília; `overdue` (abaixo)
    // é quem de fato diferencia "já passou" de "ainda hoje" pra UI agrupar.
    const endOfToday = brazilEndOfDayUTC(brazilDateKey(now));

    const tasks = await prisma.task.findMany({
      where: {
        organizationId,
        ownerId: userId,
        completedAt: null,
        OR: [
          { dueAt: { lte: endOfToday } },
          // Cadastro de cota e uma fila sem prazo de agenda. Continua no
          // sino ate ser concluido pela area administrativa.
          { dealId: { not: null }, title: { startsWith: "Cadastrar cota:" } },
        ],
      },
      orderBy: { dueAt: "asc" },
      // O sino e um resumo rapido; a Agenda mantem a lista completa.
      take: 100,
      select: {
        id: true,
        type: true,
        title: true,
        dueAt: true,
        createdAt: true,
        deal: {
          select: {
            id: true,
            name: true,
            value: true,
            grossValue: true,
            owner: { select: { name: true } },
          },
        },
        contact: { select: { id: true, name: true } },
      },
    });

    const result = tasks.map((task) => {
      const isQuotaRegistration = task.title.startsWith("Cadastrar cota:") && task.deal !== null;
      const credit = task.deal?.grossValue ?? task.deal?.value ?? null;

      return {
        id: task.id,
        type: task.type,
        title: task.title,
        dueAt: task.dueAt,
        deal: task.deal ? { id: task.deal.id, name: task.deal.name } : null,
        contact: task.contact,
        quotaRegistration: isQuotaRegistration
          ? {
              consultant: task.deal!.owner.name,
              value: credit === null ? null : Number(credit),
              requestedAt: task.createdAt,
            }
          : null,
        // Cadastro de cota e uma fila administrativa, nao um compromisso
        // com horario vencido. A data relevante e quando foi solicitado.
        overdue: !isQuotaRegistration && !!task.dueAt && task.dueAt < now,
      };
    });
    return NextResponse.json(result);
  });
}
