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
    return NextResponse.json(
      { error: "Outra execução do cron já está em andamento" },
      { status: 409 },
    );
  }
  try {
    const result = await recordCronRun(CRON_NAME, checkWhatsAppInstancesHealth);
    return NextResponse.json(result);
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
