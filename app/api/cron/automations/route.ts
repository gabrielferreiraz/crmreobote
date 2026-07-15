import { NextResponse } from "next/server";
import { runAutomations } from "@/lib/automations/engine";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

// O Vercel Cron chama esta rota via GET com o header Authorization: Bearer
// $CRON_SECRET automaticamente. POST fica disponível para disparo manual/externo.
export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const result = await runAutomations();
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const result = await runAutomations();
  return NextResponse.json(result);
}
