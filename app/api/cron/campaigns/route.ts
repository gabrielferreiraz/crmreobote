import { NextResponse } from "next/server";
import { runCampaigns } from "@/lib/campaigns/engine";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { acquireCronLock } from "@/lib/cron-lock";

export const dynamic = "force-dynamic";

const CRON_NAME = "campaigns";

async function handleCron() {
  const lock = await acquireCronLock(CRON_NAME);
  if (!lock) {
    return NextResponse.json(
      { error: "Outra execução do cron já está em andamento" },
      { status: 409 },
    );
  }
  try {
    const result = await runCampaigns();
    return NextResponse.json(result);
  } finally {
    await lock.release().catch((err) =>
      console.error("[cron:campaigns] falha ao liberar lock", err),
    );
  }
}

// Precisa rodar com frequência (1-2 min) pra o delay entre mensagens da
// campanha ter granularidade de verdade — configurar no cron-job.org com um
// intervalo curto, igual ao de automações.
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
