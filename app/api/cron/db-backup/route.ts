import { NextResponse } from "next/server";
import { runDbBackup } from "@/lib/db-backup";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { acquireCronLock } from "@/lib/cron-lock";

export const dynamic = "force-dynamic";

const CRON_NAME = "db-backup";

async function handleCron() {
  const lock = await acquireCronLock(CRON_NAME);
  if (!lock) {
    return NextResponse.json(
      { ok: false, error: "Outra execução do cron já está em andamento" },
      { status: 409 },
    );
  }
  try {
    const result = await runDbBackup();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron:db-backup] falha", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
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
