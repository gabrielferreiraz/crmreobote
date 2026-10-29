import { NextResponse } from "next/server";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { readJsonObjectOrError } from "@/lib/read-body";
import { requireSheetsAccess } from "@/lib/sheets/access";
import { setColumnArchived, updateColumn } from "@/lib/sheets/sheets";
import { firstIssue, sheetRouteError, updateColumnSchema } from "@/lib/sheets/http";

export const dynamic = "force-dynamic";

/**
 * Renomear, configurar, mover, trocar tipo e arquivar/restaurar. Troca de
 * tipo com valores incompatíveis responde 409 { invalidCount } — a tela
 * pergunta e reenvia com { force: true } para apagar só esses valores.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; columnId: string }> }) {
  const auth = await requireSheetsAccess();
  if ("response" in auth) return auth.response;
  const { access } = auth;
  const { id, columnId } = await params;
  const limited = rateLimitOrResponse(`sheets:write:${access.organizationId}:${access.userId}`, 300, 60_000);
  if (limited) return limited;

  const body = await readJsonObjectOrError(req, 64 * 1024);
  if (body instanceof NextResponse) return body;
  const parsed = updateColumnSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const actor = { ...access, source: "app" };

  try {
    const { archived, ...fields } = parsed.data;
    if (archived !== undefined) await setColumnArchived(actor, id, columnId, archived);
    const hasFields = [fields.name, fields.type, fields.config, fields.required, fields.position, fields.valueMap].some((v) => v !== undefined);
    const column = hasFields ? await updateColumn(actor, id, columnId, fields) : null;
    return NextResponse.json({ ok: true, column });
  } catch (err) {
    return sheetRouteError(err);
  }
}
