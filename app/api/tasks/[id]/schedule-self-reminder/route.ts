import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import { getDealScope, scopeWhere } from "@/lib/team-scope";

export const dynamic = "force-dynamic";

const MIN_MINUTES_BEFORE = 1;
const MAX_MINUTES_BEFORE = 24 * 60; // mesmo teto do aviso pro cliente (schedule-reminder/route.ts)

/**
 * Programa o aviso PUSH pro PRÓPRIO consultor antes de uma Reunião —
 * caminho irmão de schedule-reminder/route.ts (aquele é WhatsApp pro
 * cliente, com mensagem escolhida; este é só um push do sistema, sem texto
 * pra escrever). Ver lib/tasks/meeting-reminder.ts pro cron que manda de
 * verdade.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { minutesBefore } = body as { minutesBefore?: number };

  if (!Number.isFinite(minutesBefore) || minutesBefore! < MIN_MINUTES_BEFORE || minutesBefore! > MAX_MINUTES_BEFORE) {
    return NextResponse.json({ error: `minutesBefore precisa ser entre ${MIN_MINUTES_BEFORE} e ${MAX_MINUTES_BEFORE}` }, { status: 400 });
  }

  const { session, organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const scope = await getDealScope(organizationId, userId, session!.user.role);
    const task = await prisma.task.findFirst({ where: { id, organizationId, ...scopeWhere(scope) } });
    if (!task) return NextResponse.json({ error: "Tarefa não encontrada" }, { status: 404 });
    if (task.type !== "MEETING") {
      return NextResponse.json({ error: "Só dá pra programar aviso em tarefas do tipo Reunião" }, { status: 400 });
    }
    if (!task.dueAt) return NextResponse.json({ error: "A reunião precisa de data/hora marcada" }, { status: 400 });

    const selfReminderSendAt = new Date(task.dueAt.getTime() - minutesBefore! * 60_000);

    const updated = await prisma.task.update({
      where: { id: task.id },
      data: {
        selfReminderMinutesBefore: minutesBefore,
        selfReminderSendAt,
        // Reconfigurar (editar depois de já ter mandado) recomeça do zero —
        // mesma decisão de schedule-reminder/route.ts.
        selfReminderSentAt: null,
      },
    });

    return NextResponse.json({ selfReminderMinutesBefore: updated.selfReminderMinutesBefore, selfReminderSendAt: updated.selfReminderSendAt });
  });
}
