import { NextResponse } from "next/server";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { readJsonObjectOrError } from "@/lib/read-body";
import { requireSheetsAccess } from "@/lib/sheets/access";
import { summarizeRows } from "@/lib/sheets/rows";
import { getSheet } from "@/lib/sheets/sheets";
import { referenceNames } from "@/lib/sheets/io";
import { firstIssue, sheetRouteError, summarySchema } from "@/lib/sheets/http";

export const dynamic = "force-dynamic";

/** Resumo agrupado (base dos relatórios): { groupBy?, metrics: [{ columnId?, fn }], filters? }. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSheetsAccess();
  if ("response" in auth) return auth.response;
  const { access } = auth;
  const { id } = await params;
  const limited = rateLimitOrResponse(`sheets:read:${access.organizationId}:${access.userId}`, 600, 60_000);
  if (limited) return limited;
  const body = await readJsonObjectOrError(req, 64 * 1024);
  if (body instanceof NextResponse) return body;
  const parsed = summarySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  try {
    const groups = await summarizeRows(access.organizationId, id, parsed.data);
    // Agrupado por cliente/negócio/membro: devolve os nomes (o AutoFiltro mostra nome, não id).
    let refs: Record<string, string> = {};
    if (parsed.data.groupBy) {
      const sheet = await getSheet(access.organizationId, id);
      const col = sheet.columns.find((c) => c.id === parsed.data.groupBy);
      if (col && (col.type === "USER" || col.type === "CONTACT" || col.type === "DEAL")) {
        const fakeRows = groups.filter((g) => g.group).map((g) => ({ values: { [col.id]: g.group as string } }));
        refs = Object.fromEntries(await referenceNames(access.organizationId, [col], fakeRows));
      }
    }
    return NextResponse.json({ groups, refs });
  } catch (err) {
    return sheetRouteError(err);
  }
}
