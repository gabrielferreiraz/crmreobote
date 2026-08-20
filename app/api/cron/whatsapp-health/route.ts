import { NextResponse } from "next/server";
import { checkWhatsAppInstancesHealth } from "@/lib/whatsapp/health-check";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { acquireCronLock } from "@/lib/cron-lock";
import { recordCronRun } from "@/lib/cron-run";

export const dynamic = "force-dynamic";

const CRON_NAME = "whatsapp-health";

async function handleCron() {
  const lock = await acquireCronLock(CRON_NAME);
  if (!lock) {
    // 200 de propósito — ver comentário no catch abaixo.
    return NextResponse.json({ ok: false, skipped: true, error: "Outra execução do cron já está em andamento" });
  }
  try {
    const result = await recordCronRun(CRON_NAME, checkWhatsAppInstancesHealth);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    // 200 mesmo em falha de verdade — cron-job.org desativa um job sozinho
    // depois de falhas repetidas com status de erro (404/500). recordCronRun
    // acima já gravou a falha e mandou e-mail pro Dono (ver lib/cron-run.ts/
    // lib/system-alerts.ts) — esse já é o alerta de verdade; um 500 aqui só
    // arriscaria o cron-job.org desligar o job sozinho.
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  } finally {
    await lock.release().catch((err) =>
      console.error("[cron:whatsapp-health] falha ao liberar lock", err),
    );
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
