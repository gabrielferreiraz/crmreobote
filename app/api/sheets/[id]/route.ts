import { NextResponse } from "next/server";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { readJsonObjectOrError } from "@/lib/read-body";
import { logAudit } from "@/lib/audit-log";
import { requireSheetsAccess } from "@/lib/sheets/access";
import { deleteSheet, getSheet, listArchivedColumns, setSheetArchived, updateSheet } from "@/lib/sheets/sheets";
import { firstIssue, sheetRouteError, updateSheetSchema } from "@/lib/sheets/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Planilha + colunas ativas (as linhas vêm de /rows/query, paginadas). ?archivedColumns=1 traz as arquivadas também. */
export async function GET(req: Request, { params }: Ctx) {
  const auth = await requireSheetsAccess();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  try {
    const sheet = await getSheet(auth.access.organizationId, id);
    const withArchived = new URL(req.url).searchParams.get("archivedColumns") === "1";
    const archivedColumns = withArchived ? await listArchivedColumns(auth.access.organizationId, id) : undefined;
    return NextResponse.json({ sheet, archivedColumns });
  } catch (err) {
    return sheetRouteError(err);
  }
}

/** Renomear/descrever e arquivar/restaurar ({ archived: true|false }). */
export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await requireSheetsAccess();
  if ("response" in auth) return auth.response;
  const { access } = auth;
  const { id } = await params;
  const limited = rateLimitOrResponse(`sheets:write:${access.organizationId}:${access.userId}`, 300, 60_000);
  if (limited) return limited;

  const body = await readJsonObjectOrError(req, 16 * 1024);
  if (body instanceof NextResponse) return body;
  const parsed = updateSheetSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const actor = { ...access, source: "app" };

  try {
    const { archived, ...fields } = parsed.data;
    if (archived !== undefined) {
      await setSheetArchived(actor, id, archived);
      await logAudit({
        organizationId: access.organizationId,
        actorUserId: access.userId,
        actorName: access.actorName,
        action: archived ? "SHEET_ARCHIVED" : "SHEET_RESTORED",
        targetType: "Sheet",
        targetId: id,
      });
    }
    if (fields.name !== undefined || fields.description !== undefined || fields.settings !== undefined) await updateSheet(actor, id, fields);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return sheetRouteError(err);
  }
}

/** Apagar a planilha permanentemente. */
export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await requireSheetsAccess();
  if ("response" in auth) return auth.response;
  const { access } = auth;
  const { id } = await params;
  const limited = rateLimitOrResponse(`sheets:write:${access.organizationId}:${access.userId}`, 60, 60_000);
  if (limited) return limited;

  const actor = { ...access, source: "app" };

  try {
    const deleted = await deleteSheet(actor, id);
    await logAudit({
      organizationId: access.organizationId,
      actorUserId: access.userId,
      actorName: access.actorName,
      action: "SHEET_DELETED",
      targetType: "Sheet",
      targetId: id,
    });
    return NextResponse.json({ ok: true, name: deleted.name });
  } catch (err) {
    return sheetRouteError(err);
  }
}
