import { NextResponse } from "next/server";
import { runAutomations } from "@/lib/automations/engine";

export const dynamic = "force-dynamic";

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  return !!secret && header === `Bearer ${secret}`;
}

// O Vercel Cron chama esta rota via GET com o header Authorization: Bearer
// $CRON_SECRET automaticamente. POST fica disponível para disparo manual/externo.
export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const result = await runAutomations();
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const result = await runAutomations();
  return NextResponse.json(result);
}
