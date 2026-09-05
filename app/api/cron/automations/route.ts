import { NextResponse } from "next/server";
import { runAutomations } from "@/lib/automations/engine";
import { runCampaigns } from "@/lib/campaigns/engine";
import { runWebhookDeliveries } from "@/lib/webhooks/engine";
import { sendDueScheduledTaskMessages } from "@/lib/tasks/scheduled-whatsapp";
import { sendDueMeetingReminders, sendDueSelfReminders } from "@/lib/tasks/meeting-reminder";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { acquireCronLock } from "@/lib/cron-lock";
import { recordCronRun, runLockedCron } from "@/lib/cron-run";

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
//
// campaignsBackstop/webhooksBackstop: "automations" é, na prática, o cron
// mais confiável que existe aqui (nunca deixou de rodar) — os outros dois
// (ver rotas dedicadas app/api/cron/campaigns e .../webhooks) dependem só
// do cron-job.org continuar chamando, e esse serviço externo já desativou/
// removeu job sozinho mais de uma vez neste projeto sem avisar (campaigns
// ficou dias parado em 2026-08 E de novo em 2026-09, junto com webhooks,
// que nunca chegou a rodar nenhuma vez) — nos dois casos sem NENHUMA falha
// registrada, porque a chamada externa simplesmente parou de chegar, o que
// nenhum código rodando SÓ dentro da própria rota consegue perceber
// sozinho. Rodar os dois também por aqui (com o MESMO lock por nome, via
// runLockedCron) garante que, mesmo se o cron-job.org esquecer os dois de
// novo, eles continuam funcionando — a rota dedicada e este backstop nunca
// processam a mesma coisa duas vezes (o segundo a chegar acha o lock preso
// e sai com skipped:true). Cada um grava seu PRÓPRIO CronRun/alerta sob o
// nome real (ver lib/cron-watchdog.ts) — uma falha aqui nunca derruba o
// tick de automations (por isso o .catch em cada um, não deixado estourar
// pro Promise.all inteiro).
async function runCronTick() {
  const [automations, scheduledMessages, meetingReminders, selfReminders, campaignsBackstop, webhooksBackstop] =
    await Promise.all([
      runAutomations(),
      sendDueScheduledTaskMessages(),
      sendDueMeetingReminders(),
      sendDueSelfReminders(),
      runLockedCron("campaigns", runCampaigns).catch((err) => {
        console.error("[cron:automations] backstop de campaigns falhou", err);
        return { backstopFailed: true };
      }),
      runLockedCron("webhooks", runWebhookDeliveries).catch((err) => {
        console.error("[cron:automations] backstop de webhooks falhou", err);
        return { backstopFailed: true };
      }),
    ]);
  return { automations, scheduledMessages, meetingReminders, selfReminders, campaignsBackstop, webhooksBackstop };
}

async function handleCron() {
  try {
    // acquireCronLock roda POR DENTRO do recordCronRun agora (não antes, num
    // try separado) — se ela mesma falhar (ex.: blip de conexão com o
    // Postgres bem na hora do tick), a falha precisa ser GRAVADA e ALERTADA
    // igual a qualquer outra, não escapar crua como um 500 que o cron-job.org
    // usaria pra desativar o job sozinho e silenciosamente (foi exatamente
    // isso que aconteceu com o cron de campanhas em 2026-08: ficou 6 dias sem
    // rodar, sem nenhum registro, porque a falha nunca chegava a ser gravada
    // — ver lib/cron-watchdog.ts, que agora vigia isso a partir de outro cron).
    // recordCronRun grava sucesso/falha em CronRun (ver "Saúde do sistema"
    // em Configurações) e manda e-mail pro Dono se o tick inteiro quebrar —
    // ver lib/cron-run.ts.
    const result = await recordCronRun(CRON_NAME, async () => {
      const lock = await acquireCronLock(CRON_NAME);
      if (!lock) return { skipped: true };
      try {
        return await runCronTick();
      } finally {
        await lock.release().catch((err) =>
          console.error("[cron:automations] falha ao liberar lock", err),
        );
      }
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    // 200 mesmo em falha de verdade — cron-job.org DESATIVA um job sozinho
    // depois de falhas repetidas com status de erro (404/500). recordCronRun
    // acima já gravou a falha e já mandou o e-mail (esse é o alerta de
    // verdade, ver lib/system-alerts.ts) — um 500 aqui só arrisca o
    // cron-job.org desligar o job e a gente parar de saber quando volta a
    // funcionar, sem ganhar nada em troca.
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
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
