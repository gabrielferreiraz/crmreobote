import { NextResponse } from "next/server";
import { runDbBackup } from "@/lib/db-backup";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

// Mesmo esquema de autenticação dos outros crons (ver /api/cron/automations).
export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  try {
    const result = await runDbBackup();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron:db-backup] falha", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  try {
    const result = await runDbBackup();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron:db-backup] falha", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
