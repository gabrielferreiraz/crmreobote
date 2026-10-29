import { apiSuccess } from "@/lib/api/v1-response";
import { summarizeRows } from "@/lib/sheets/rows";
import { summarySchema } from "@/lib/sheets/http";
import { readV1Body, requireSheetsApi, v1SheetError } from "@/lib/sheets/v1";

export const dynamic = "force-dynamic";

/** Resumo agrupado: { groupBy?, metrics: [{ columnId?, fn }], filters? } — alimenta BI/relatórios externos. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSheetsApi(req, "read");
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const body = await readV1Body(req, summarySchema, 64 * 1024);
  if ("response" in body) return body.response;
  try {
    return apiSuccess({ groups: await summarizeRows(auth.actor.organizationId, id, body.data) });
  } catch (err) {
    return v1SheetError(err);
  }
}
