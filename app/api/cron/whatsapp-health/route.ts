import { NextResponse } from "next/server";
import { checkWhatsAppInstancesHealth } from "@/lib/whatsapp/health-check";

export const dynamic = "force-dynamic";

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  return !!secret && header === `Bearer ${secret}`;
}

// Mesmo esquema de autenticação dos outros crons (ver /api/cron/automations).
export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const result = await checkWhatsAppInstancesHealth();
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const result = await checkWhatsAppInstancesHealth();
  return NextResponse.json(result);
}
