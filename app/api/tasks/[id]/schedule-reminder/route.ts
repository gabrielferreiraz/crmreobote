import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import { getDealScope, scopeWhere } from "@/lib/team-scope";
import type { ScriptStep } from "@/lib/campaigns/spintax";

export const dynamic = "force-dynamic";

const MIN_MINUTES_BEFORE = 1;
const MAX_MINUTES_BEFORE = 24 * 60; // 1 dia — generoso o bastante, sem deixar programar "3 meses antes" por engano

/**
 * Programa o aviso automático de WhatsApp antes de uma Reunião — mensagem
 * avulsa (`message`) OU um Script já existente da biblioteca (`scriptId`,
 * copiado aqui como está: mudança futura no Script não altera um aviso já
 * programado). Ver lib/tasks/meeting-reminder.ts pro cron que manda de
 * verdade.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { minutesBefore, message, scriptId } = body as { minutesBefore?: number; message?: string; scriptId?: string };

  if (!Number.isFinite(minutesBefore) || minutesBefore! < MIN_MINUTES_BEFORE || minutesBefore! > MAX_MINUTES_BEFORE) {
    return NextResponse.json({ error: `minutesBefore precisa ser entre ${MIN_MINUTES_BEFORE} e ${MAX_MINUTES_BEFORE}` }, { status: 400 });
  }
  if (!message?.trim() && !scriptId) {
    return NextResponse.json({ error: "Envie 'message' (texto avulso) ou 'scriptId' (script já criado)" }, { status: 400 });
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
    if (!task.contactId) return NextResponse.json({ error: "A reunião precisa de um cliente vinculado" }, { status: 400 });

    let steps: ScriptStep[];
    if (scriptId) {
      const script = await prisma.messageScript.findFirst({ where: { id: scriptId, organizationId } });
      if (!script) return NextResponse.json({ error: "Script não encontrado" }, { status: 404 });
      steps = script.steps as unknown as ScriptStep[];
      if (!Array.isArray(steps) || steps.length === 0) {
        return NextResponse.json({ error: "Este script não tem mensagens" }, { status: 400 });
      }
    } else {
      steps = [{ text: message!.trim(), delayAfterSec: 0 }];
    }

    const reminderNextSendAt = new Date(task.dueAt.getTime() - minutesBefore! * 60_000);

    const updated = await prisma.task.update({
      where: { id: task.id },
      data: {
        reminderMinutesBefore: minutesBefore,
        reminderSteps: steps as unknown as Prisma.InputJsonValue,
        reminderStepIndex: 0,
        reminderNextSendAt,
        // Reconfigurar um aviso (editar depois de já ter mandado/falhado)
        // recomeça do zero — decisão simples: se a pessoa está aqui de
        // novo mexendo nisso, é porque quer que rode de novo.
        reminderSentAt: null,
        reminderFailedAt: null,
      },
    });

    return NextResponse.json({ reminderMinutesBefore: updated.reminderMinutesBefore, reminderNextSendAt: updated.reminderNextSendAt });
  });
}
