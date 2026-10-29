import { NextResponse } from "next/server";
import { getServopaTablesAccess } from "@/lib/servopa-tables/access";
import { listServopaSyncHistory } from "@/lib/servopa-tables/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await getServopaTablesAccess();
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (!access.canOperate) return NextResponse.json({ error: "Sem permissão para ver o histórico do robô." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const history = await listServopaSyncHistory(access.organizationId);
  return NextResponse.json({ history }, { headers: { "Cache-Control": "no-store" } });
}
