import { NextResponse } from "next/server";
import { runWebhookDeliveries } from "@/lib/webhooks/engine";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

// Precisa rodar com frequência (1-2 min) pro retry com backoff ter
// granularidade de verdade — configurar no cron-job.org com um intervalo
// curto, igual ao de campanhas/automações.
export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const result = await runWebhookDeliveries();
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const result = await runWebhookDeliveries();
  return NextResponse.json(result);
}
