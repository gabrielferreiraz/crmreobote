import { apiSuccess } from "@/lib/api/v1-response";
import { insertRows, queryRows, setRowsDeleted, updateRows } from "@/lib/sheets/rows";
import { sheetRef } from "@/lib/sheets/sheets";
import { emitRowEvents, insertRowsSchema, rowIdsSchema, updateRowsSchema } from "@/lib/sheets/http";
import { readV1Body, requireSheetsApi, v1SheetError } from "@/lib/sheets/v1";
import { recalcAfterWrite } from "@/lib/sheets/recalc";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Linhas paginadas (?limit=&offset=&search=). Filtros completos: POST /rows/query. */
export async function GET(req: Request, { params }: Ctx) {
  const auth = await requireSheetsApi(req, "read");
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const sp = new URL(req.url).searchParams;
  try {
    const page = await queryRows(auth.actor.organizationId, id, {
      limit: Number(sp.get("limit")) || undefined,
      offset: Number(sp.get("offset")) || undefined,
      search: sp.get("search") ?? undefined,
    });
    return apiSuccess({ rows: page.rows, total: page.total, offset: page.offset, limit: page.limit });
  } catch (err) {
    return v1SheetError(err);
  }
}

/** Cria linhas: { rows: [{ <columnId>: valor }] } (até 1.000 por chamada). */
export async function POST(req: Request, { params }: Ctx) {
  const auth = await requireSheetsApi(req, "write");
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const body = await readV1Body(req, insertRowsSchema);
  if ("response" in body) return body.response;
  try {
    const rows = await insertRows(auth.actor, id, body.data.rows);
    // Integração não passa pela tela: as fórmulas que dependem destas células são recalculadas aqui.
    await recalcAfterWrite(auth.actor.organizationId, id);
    emitRowEvents(auth.actor.organizationId, "sheet.row.created", await sheetRef(auth.actor.organizationId, id), rows);
    return apiSuccess({ rows }, 201);
  } catch (err) {
    return v1SheetError(err);
  }
}

/** Atualiza células: { rows: [{ id, values: { <columnId>: valor|null } }] }. */
export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await requireSheetsApi(req, "write");
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const body = await readV1Body(req, updateRowsSchema);
  if ("response" in body) return body.response;
  try {
    const rows = await updateRows(auth.actor, id, body.data.rows);
    // Integração não passa pela tela: as fórmulas que dependem destas células são recalculadas aqui.
    await recalcAfterWrite(auth.actor.organizationId, id);
    if (rows.length) emitRowEvents(auth.actor.organizationId, "sheet.row.updated", await sheetRef(auth.actor.organizationId, id), rows);
    return apiSuccess({ rows });
  } catch (err) {
    return v1SheetError(err);
  }
}

/** Manda linhas para a lixeira: { ids: [...] } (reversível pela tela). */
export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await requireSheetsApi(req, "write");
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const body = await readV1Body(req, rowIdsSchema);
  if ("response" in body) return body.response;
  try {
    const deleted = await setRowsDeleted(auth.actor, id, body.data.ids, true);
    // Integração não passa pela tela: as fórmulas que dependem destas células são recalculadas aqui.
    await recalcAfterWrite(auth.actor.organizationId, id);
    if (deleted) {
      const ref = await sheetRef(auth.actor.organizationId, id);
      emitRowEvents(auth.actor.organizationId, "sheet.row.deleted", ref, body.data.ids.map((rowId) => ({ id: rowId, values: {} })));
    }
    return apiSuccess({ deleted });
  } catch (err) {
    return v1SheetError(err);
  }
}
