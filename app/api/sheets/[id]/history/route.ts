import { NextResponse } from "next/server";
import { requireSheetsAccess } from "@/lib/sheets/access";
import { rowHistory } from "@/lib/sheets/rows";
import { sheetRouteError } from "@/lib/sheets/http";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { readJsonObjectOrError } from "@/lib/read-body";
import { restoreVersion, versionPlan } from "@/lib/sheets/history";
import { recalcAfterWrite } from "@/lib/sheets/recalc";

export const dynamic = "force-dynamic";

/** Histórico de alterações da planilha (?rowId= para uma linha só). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSheetsAccess();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const sp = new URL(req.url).searchParams;
  try {
    const version = sp.get("version");
    if (version) return NextResponse.json({ plan: await versionPlan(auth.access.organizationId, id, version) });
    const items = await rowHistory(auth.access.organizationId, id, {
      rowId: sp.get("rowId") ?? undefined,
      limit: Number(sp.get("limit")) || undefined,
    });
    return NextResponse.json({ items });
  } catch (err) {
    return sheetRouteError(err);
  }
}

/** Restaura o estado imediatamente posterior ao evento escolhido. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSheetsAccess();
  if ("response" in auth) return auth.response;
  const { access } = auth;
  const { id } = await params;
  const limited = rateLimitOrResponse(`sheets:history-restore:${access.organizationId}:${access.userId}`, 10, 60_000);
  if (limited) return limited;
  const body = await readJsonObjectOrError(req, 16 * 1024);
  if (body instanceof NextResponse) return body;
  const activityId = typeof body.activityId === "string" ? body.activityId : "";
  if (!activityId || activityId.length > 64) return NextResponse.json({ error: "Versão inválida" }, { status: 400 });
  try {
    const result = await restoreVersion({ ...access, source: "app" }, id, activityId);
    await recalcAfterWrite(access.organizationId, id);
    return NextResponse.json(result);
  } catch (err) {
    return sheetRouteError(err);
  }
}
