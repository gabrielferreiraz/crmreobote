import { NextResponse } from "next/server";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { readJsonObjectOrError } from "@/lib/read-body";
import { logAudit } from "@/lib/audit-log";
import { requireSheetsAccess } from "@/lib/sheets/access";
import { createSheet, listSheets } from "@/lib/sheets/sheets";
import { createSheetSchema, firstIssue, sheetRouteError } from "@/lib/sheets/http";

export const dynamic = "force-dynamic";

/** Planilhas da organização (?archived=1 = as arquivadas). Somente Administrativo/Dono. */
export async function GET(req: Request) {
  const auth = await requireSheetsAccess();
  if ("response" in auth) return auth.response;
  const archived = new URL(req.url).searchParams.get("archived") === "1";
  return NextResponse.json({ sheets: await listSheets(auth.access.organizationId, { archived }) });
}

export async function POST(req: Request) {
  const auth = await requireSheetsAccess();
  if ("response" in auth) return auth.response;
  const { access } = auth;
  const limited = rateLimitOrResponse(`sheets:create:${access.organizationId}:${access.userId}`, 30, 60_000);
  if (limited) return limited;

  const body = await readJsonObjectOrError(req, 256 * 1024);
  if (body instanceof NextResponse) return body;
  const parsed = createSheetSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });

  try {
    const sheet = await createSheet({ ...access, source: "app" }, parsed.data);
    await logAudit({
      organizationId: access.organizationId,
      actorUserId: access.userId,
      actorName: access.actorName,
      action: "SHEET_CREATED",
      targetType: "Sheet",
      targetId: sheet.id,
      detail: `Criou a planilha "${parsed.data.name.trim()}".`,
    });
    return NextResponse.json({ id: sheet.id }, { status: 201 });
  } catch (err) {
    return sheetRouteError(err);
  }
}
