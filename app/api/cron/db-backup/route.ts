import { NextResponse } from "next/server";
import { runDbBackup } from "@/lib/db-backup";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { acquireCronLock } from "@/lib/cron-lock";
import { recordCronRun } from "@/lib/cron-run";

export const dynamic = "force-dynamic";

const CRON_NAME = "db-backup";

async function handleCron() {
  const lock = await acquireCronLock(CRON_NAME);
  if (!lock) {
    // 200 de propósito — ver comentário no catch abaixo.
    return NextResponse.json({ ok: false, skipped: true, error: "Outra execução do cron já está em andamento" });
  }
  try {
    // recordCronRun grava sucesso/falha em CronRun e manda e-mail pro Dono
    // se falhar (ver lib/cron-run.ts) — o backup é o cron mais arriscado de
    // falhar em silêncio (erro só voltava numa resposta HTTP que ninguém
    // olhava), por isso este é o motivo original de existir essa gravação.
    const result = await recordCronRun(CRON_NAME, runDbBackup);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron:db-backup] falha", err);
    // 200 mesmo em falha de verdade (não mais 500) — cron-job.org desativa
    // um job sozinho depois de falhas repetidas com status de erro. O
    // e-mail que recordCronRun já mandou é o alerta de verdade; um 500 aqui
    // só arriscaria o cron-job.org desligar o job e a gente parar de saber
    // quando o backup volta a funcionar.
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  } finally {
    await lock.release().catch((err) =>
      console.error("[cron:db-backup] falha ao liberar lock", err),
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
