import { NextResponse } from "next/server";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { readJsonObjectOrError } from "@/lib/read-body";
import { requireSheetsAccess } from "@/lib/sheets/access";
import { setRowsDeletedDetailed } from "@/lib/sheets/rows";
import { firstIssue, rowIdsSchema, sheetRouteError } from "@/lib/sheets/http";

export const dynamic = "force-dynamic";

/** Tira linhas da lixeira ({ ids }). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSheetsAccess();
  if ("response" in auth) return auth.response;
  const { access } = auth;
  const { id } = await params;
  const limited = rateLimitOrResponse(`sheets:rows:${access.organizationId}:${access.userId}`, 600, 60_000);
  if (limited) return limited;
  const body = await readJsonObjectOrError(req, 4 * 1024 * 1024);
  if (body instanceof NextResponse) return body;
  const parsed = rowIdsSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  try {
    const { count, formulaChanges } = await setRowsDeletedDetailed({ ...access, source: "app" }, id, parsed.data.ids, false);
    return NextResponse.json({ restored: count, formulaChanges });
  } catch (err) {
    return sheetRouteError(err);
  }
}
