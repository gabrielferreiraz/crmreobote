import { NextResponse } from "next/server";
import { checkWhatsAppInstancesHealth } from "@/lib/whatsapp/health-check";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

// Mesmo esquema de autenticação dos outros crons (ver /api/cron/automations).
export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const result = await checkWhatsAppInstancesHealth();
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const result = await checkWhatsAppInstancesHealth();
  return NextResponse.json(result);
}
