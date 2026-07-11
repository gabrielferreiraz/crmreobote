import { NextResponse } from "next/server";
import { cleanupExpiredChatMedia } from "@/lib/whatsapp/media-cleanup";

export const dynamic = "force-dynamic";

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  return !!secret && header === `Bearer ${secret}`;
}

// Mesmo mecanismo de autenticação do /api/cron/automations — um único
// CRON_SECRET compartilhado entre os jobs agendados desta app.
export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const result = await cleanupExpiredChatMedia();
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const result = await cleanupExpiredChatMedia();
  return NextResponse.json(result);
}
