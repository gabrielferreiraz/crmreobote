import { apiSuccess } from "@/lib/api/v1-response";
import { queryRows } from "@/lib/sheets/rows";
import { queryRowsSchema } from "@/lib/sheets/http";
import { readV1Body, requireSheetsApi, v1SheetError } from "@/lib/sheets/v1";

export const dynamic = "force-dynamic";

/** Consulta com filtros/ordenação: { filters, match, sort, search, offset, limit }. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSheetsApi(req, "read");
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const body = await readV1Body(req, queryRowsSchema, 64 * 1024);
  if ("response" in body) return body.response;
  try {
    const page = await queryRows(auth.actor.organizationId, id, { ...body.data, deleted: false });
    return apiSuccess({ rows: page.rows, total: page.total, offset: page.offset, limit: page.limit });
  } catch (err) {
    return v1SheetError(err);
  }
}
