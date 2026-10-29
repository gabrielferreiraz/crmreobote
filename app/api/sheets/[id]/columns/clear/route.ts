import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { readJsonObjectOrError } from "@/lib/read-body";
import { requireSheetsAccess } from "@/lib/sheets/access";
import { clearColumns } from "@/lib/sheets/sheets";
import { firstIssue, sheetRouteError } from "@/lib/sheets/http";
import { SHEET_LIMITS } from "@/lib/sheets/limits";

export const dynamic = "force-dynamic";

const schema = z.object({ columnIds: z.array(z.string().min(1).max(64)).min(1).max(SHEET_LIMITS.columnsPerSheet) });

/** Delete com colunas inteiras selecionadas: limpa o conteúdo de todas as linhas (a coluna fica). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSheetsAccess();
  if ("response" in auth) return auth.response;
  const { access } = auth;
  const { id } = await params;
  const limited = rateLimitOrResponse(`sheets:write:${access.organizationId}:${access.userId}`, 300, 60_000);
  if (limited) return limited;
  const body = await readJsonObjectOrError(req, 64 * 1024);
  if (body instanceof NextResponse) return body;
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  try {
    return NextResponse.json({ cleared: await clearColumns({ ...access, source: "app" }, id, parsed.data.columnIds) });
  } catch (err) {
    return sheetRouteError(err);
  }
}
