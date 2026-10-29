import { NextResponse } from "next/server";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { readJsonObjectOrError } from "@/lib/read-body";
import { requireSheetsAccess } from "@/lib/sheets/access";
import { sheetRef } from "@/lib/sheets/sheets";
import { insertRows, setRowsDeletedDetailed, updateRows } from "@/lib/sheets/rows";
import { emitRowEvents, firstIssue, insertRowsSchema, rowIdsSchema, sheetRouteError, updateRowsSchema } from "@/lib/sheets/http";
import { SHEET_LIMITS } from "@/lib/sheets/limits";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Colar planilhas grandes do Excel (com valores, marcações e fórmulas) pode chegar a dezenas de MB de JSON.
const ROWS_BODY_LIMIT = SHEET_LIMITS.pasteBodyBytes;

async function guard(req: Request) {
  const auth = await requireSheetsAccess();
  if ("response" in auth) return auth;
  const limited = rateLimitOrResponse(`sheets:rows:${auth.access.organizationId}:${auth.access.userId}`, 600, 60_000);
  if (limited) return { response: limited };
  const body = await readJsonObjectOrError(req, ROWS_BODY_LIMIT);
  if (body instanceof NextResponse) return { response: body };
  return { access: auth.access, body };
}

/** Insere linhas ({ rows: [{ <columnId>: valor }] }) no fim da planilha. */
export async function POST(req: Request, { params }: Ctx) {
  const g = await guard(req);
  if ("response" in g) return g.response;
  const { id } = await params;
  const parsed = insertRowsSchema.safeParse(g.body);
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  try {
    const rows = await insertRows({ ...g.access, source: "app" }, id, parsed.data.rows, (parsed.data.extras ?? []).map((e) => e ?? undefined));
    emitRowEvents(g.access.organizationId, "sheet.row.created", await sheetRef(g.access.organizationId, id), rows);
    return NextResponse.json({ rows }, { status: 201 });
  } catch (err) {
    return sheetRouteError(err);
  }
}

/** Atualiza células ({ rows: [{ id, values: { <columnId>: valor|null } }] }) — só as enviadas mudam. */
export async function PATCH(req: Request, { params }: Ctx) {
  const g = await guard(req);
  if ("response" in g) return g.response;
  const { id } = await params;
  const parsed = updateRowsSchema.safeParse(g.body);
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  try {
    const rows = await updateRows({ ...g.access, source: "app" }, id, parsed.data.rows);
    if (rows.length) emitRowEvents(g.access.organizationId, "sheet.row.updated", await sheetRef(g.access.organizationId, id), rows);
    return NextResponse.json({ rows });
  } catch (err) {
    return sheetRouteError(err);
  }
}

/** Manda linhas para a lixeira ({ ids }) — restaurar em /rows/restore. */
export async function DELETE(req: Request, { params }: Ctx) {
  const g = await guard(req);
  if ("response" in g) return g.response;
  const { id } = await params;
  const parsed = rowIdsSchema.safeParse(g.body);
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  try {
    const { count, formulaChanges } = await setRowsDeletedDetailed({ ...g.access, source: "app" }, id, parsed.data.ids, true);
    if (count) {
      const ref = await sheetRef(g.access.organizationId, id);
      emitRowEvents(g.access.organizationId, "sheet.row.deleted", ref, parsed.data.ids.map((rowId) => ({ id: rowId, values: {} })));
    }
    // formulaChanges: fórmulas de outras linhas reescritas (o Ctrl+Z da tela devolve o texto original).
    return NextResponse.json({ deleted: count, formulaChanges });
  } catch (err) {
    return sheetRouteError(err);
  }
}
