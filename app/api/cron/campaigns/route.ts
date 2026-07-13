import { NextResponse } from "next/server";
import { runCampaigns } from "@/lib/campaigns/engine";

export const dynamic = "force-dynamic";

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  return !!secret && header === `Bearer ${secret}`;
}

// Precisa rodar com frequência (1-2 min) pra o delay entre mensagens da
// campanha ter granularidade de verdade — configurar no cron-job.org com um
// intervalo curto, igual ao de automações.
export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const result = await runCampaigns();
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const result = await runCampaigns();
  return NextResponse.json(result);
}
