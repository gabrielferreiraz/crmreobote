import { NextResponse } from "next/server";
import { checkWhatsAppInstancesHealth } from "@/lib/whatsapp/health-check";
import { checkStaleCrons } from "@/lib/cron-watchdog";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { acquireCronLock } from "@/lib/cron-lock";
import { recordCronRun } from "@/lib/cron-run";

export const dynamic = "force-dynamic";

const CRON_NAME = "whatsapp-health";

// checkStaleCrons pega carona aqui (não um cron externo próprio) porque
// precisa de ALGUM cron que já roda de forma confiável a cada 1-2min pra
// vigiar os outros — este é tão bom candidato quanto automations, e faz
// sentido temático (ambos são "saúde do sistema").
async function runCronTick() {
  const [health, staleCrons] = await Promise.all([checkWhatsAppInstancesHealth(), checkStaleCrons()]);
  return { health, staleCrons };
}

async function handleCron() {
  try {
    // acquireCronLock também roda POR DENTRO do recordCronRun agora (não
    // antes, num try separado) — se ela mesma falhar (ex.: blip de conexão
    // com o Postgres bem na hora do tick), a falha precisa ser GRAVADA e
    // ALERTADA igual a qualquer outra, não escapar crua como um 500 que o
    // cron-job.org usaria pra desativar o job sozinho e silenciosamente (foi
    // exatamente isso que aconteceu com o cron de campanhas em 2026-08: ficou
    // 6 dias sem rodar, sem nenhum registro, porque a falha nunca chegava a
    // ser gravada — ver lib/cron-watchdog.ts).
    const result = await recordCronRun(CRON_NAME, async () => {
      const lock = await acquireCronLock(CRON_NAME);
      if (!lock) return { skipped: true };
      try {
        return await runCronTick();
      } finally {
        await lock.release().catch((err) =>
          console.error("[cron:whatsapp-health] falha ao liberar lock", err),
        );
      }
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    // 200 mesmo em falha de verdade — cron-job.org desativa um job sozinho
    // depois de falhas repetidas com status de erro (404/500). recordCronRun
    // acima já gravou a falha e mandou e-mail pro Dono (ver lib/cron-run.ts/
    // lib/system-alerts.ts) — esse já é o alerta de verdade; um 500 aqui só
    // arriscaria o cron-job.org desligar o job sozinho.
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// Mesmo esquema de autenticação dos outros crons (ver /api/cron/automations).
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
