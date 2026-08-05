import { NextResponse } from "next/server";
import { runAutomations } from "@/lib/automations/engine";
import { sendDueScheduledTaskMessages } from "@/lib/tasks/scheduled-whatsapp";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { acquireCronLock } from "@/lib/cron-lock";

export const dynamic = "force-dynamic";

const CRON_NAME = "automations";

// Mensagens de WhatsApp programadas em tarefa (ver lib/tasks/scheduled-whatsapp.ts)
// pegam carona neste mesmo tick — já roda a cada 1-2min via cron-job.org em
// produção, então não precisa de uma entrada de cron externa nova (config
// manual, fora do código, que ninguém lembraria de criar). Os dois jobs são
// independentes (cada um faz seu próprio loop por organização com
// runWithTenant próprio), então Promise.all é seguro.
async function runCronTick() {
  const [automations, scheduledMessages] = await Promise.all([runAutomations(), sendDueScheduledTaskMessages()]);
  return { automations, scheduledMessages };
}

async function handleCron() {
  const lock = await acquireCronLock(CRON_NAME);
  if (!lock) {
    return NextResponse.json(
      { error: "Outra execução do cron já está em andamento" },
      { status: 409 },
    );
  }
  try {
    const result = await runCronTick();
    return NextResponse.json(result);
  } finally {
    await lock.release().catch((err) =>
      console.error("[cron:automations] falha ao liberar lock", err),
    );
  }
}

// O Vercel Cron chama esta rota via GET com o header Authorization: Bearer
// $CRON_SECRET automaticamente. POST fica disponível para disparo manual/externo.
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
