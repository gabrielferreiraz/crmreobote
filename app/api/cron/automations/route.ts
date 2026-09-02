import { NextResponse } from "next/server";
import { runAutomations } from "@/lib/automations/engine";
import { sendDueScheduledTaskMessages } from "@/lib/tasks/scheduled-whatsapp";
import { sendDueMeetingReminders, sendDueSelfReminders } from "@/lib/tasks/meeting-reminder";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { acquireCronLock } from "@/lib/cron-lock";
import { recordCronRun } from "@/lib/cron-run";

export const dynamic = "force-dynamic";

const CRON_NAME = "automations";

// Mensagens de WhatsApp programadas em tarefa (ver lib/tasks/scheduled-whatsapp.ts)
// e avisos automáticos antes de Reunião — pro cliente via WhatsApp e pro
// próprio consultor via push (ver lib/tasks/meeting-reminder.ts, os dois
// caminhos moram no mesmo arquivo) — pegam carona neste mesmo tick — já
// roda a cada 1-2min via cron-job.org em produção, então não precisa de uma
// entrada de cron externa nova (config manual, fora do código, que ninguém
// lembraria de criar). Os quatro jobs são independentes (cada um faz seu
// próprio loop por organização com runWithTenant próprio), então Promise.all
// é seguro.
async function runCronTick() {
  const [automations, scheduledMessages, meetingReminders, selfReminders] = await Promise.all([
    runAutomations(),
    sendDueScheduledTaskMessages(),
    sendDueMeetingReminders(),
    sendDueSelfReminders(),
  ]);
  return { automations, scheduledMessages, meetingReminders, selfReminders };
}

async function handleCron() {
  const lock = await acquireCronLock(CRON_NAME);
  if (!lock) {
    // 200 de propósito, não 409 — ver comentário no catch abaixo sobre por
    // que nenhum desfecho aqui devolve status de erro pro cron-job.org.
    return NextResponse.json({ ok: false, skipped: true, error: "Outra execução do cron já está em andamento" });
  }
  try {
    // recordCronRun grava sucesso/falha em CronRun (ver "Saúde do sistema"
    // em Configurações) e manda e-mail pro Dono se o tick inteiro quebrar —
    // ver lib/cron-run.ts.
    const result = await recordCronRun(CRON_NAME, runCronTick);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    // 200 mesmo em falha de verdade — cron-job.org DESATIVA um job sozinho
    // depois de falhas repetidas com status de erro (404/500). recordCronRun
    // acima já gravou a falha e já mandou o e-mail (esse é o alerta de
    // verdade, ver lib/system-alerts.ts) — um 500 aqui só arrisca o
    // cron-job.org desligar o job e a gente parar de saber quando volta a
    // funcionar, sem ganhar nada em troca.
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  } finally {
    await lock.release().catch((err) =>
      console.error("[cron:automations] falha ao liberar lock", err),
    );
  }
}

// cron-job.org chama esta rota via GET com o header Authorization: Bearer
// $CRON_SECRET (configurado lá, fora do código). POST fica disponível para
// disparo manual/externo.
export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  return handleCron();
}

export async function POST(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  return handleCron();
}
