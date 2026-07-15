import { NextResponse } from "next/server";
import { cleanupExpiredChatMedia } from "@/lib/whatsapp/media-cleanup";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

// Mesmo mecanismo de autenticação do /api/cron/automations — um único
// CRON_SECRET compartilhado entre os jobs agendados desta app.
export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const result = await cleanupExpiredChatMedia();
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const result = await cleanupExpiredChatMedia();
  return NextResponse.json(result);
}
