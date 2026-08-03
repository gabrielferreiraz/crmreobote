import { NextResponse } from "next/server";
import { runAutomations } from "@/lib/automations/engine";
import { sendDueScheduledTaskMessages } from "@/lib/tasks/scheduled-whatsapp";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

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

// O Vercel Cron chama esta rota via GET com o header Authorization: Bearer
// $CRON_SECRET automaticamente. POST fica disponível para disparo manual/externo.
export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const result = await runCronTick();
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const result = await runCronTick();
  return NextResponse.json(result);
}
