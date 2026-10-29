import { NextResponse } from "next/server";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { readJsonObjectOrError } from "@/lib/read-body";
import { requireSheetsAccess } from "@/lib/sheets/access";
import { queryRows } from "@/lib/sheets/rows";
import { referenceNamesFast } from "@/lib/sheets/open";
import { firstIssue, queryRowsSchema, sheetRouteError } from "@/lib/sheets/http";

export const dynamic = "force-dynamic";

/** Linhas paginadas com filtros/ordenação/busca (POST porque o filtro é um objeto, não cabe bem em query string). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSheetsAccess();
  if ("response" in auth) return auth.response;
  const { access } = auth;
  const { id } = await params;
  const limited = rateLimitOrResponse(`sheets:read:${access.organizationId}:${access.userId}`, 600, 60_000);
  if (limited) return limited;
  const body = await readJsonObjectOrError(req, 64 * 1024);
  if (body instanceof NextResponse) return body;
  const parsed = queryRowsSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  try {
    const page = await queryRows(access.organizationId, id, parsed.data);
    // Nome de cliente/negócio/membro já resolvido: a grade mostra nome, não id.
    const refs = await referenceNamesFast(access.organizationId, page.columns, page.rows);
    return NextResponse.json({ ...page, refs });
  } catch (err) {
    return sheetRouteError(err);
  }
}
