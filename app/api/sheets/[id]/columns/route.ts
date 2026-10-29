import { NextResponse } from "next/server";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { readJsonObjectOrError } from "@/lib/read-body";
import { requireSheetsAccess } from "@/lib/sheets/access";
import { createColumn } from "@/lib/sheets/sheets";
import { createColumnSchema, firstIssue, sheetRouteError } from "@/lib/sheets/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSheetsAccess();
  if ("response" in auth) return auth.response;
  const { access } = auth;
  const { id } = await params;
  const limited = rateLimitOrResponse(`sheets:write:${access.organizationId}:${access.userId}`, 300, 60_000);
  if (limited) return limited;

  const body = await readJsonObjectOrError(req, 64 * 1024);
  if (body instanceof NextResponse) return body;
  const parsed = createColumnSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });

  try {
    const column = await createColumn({ ...access, source: "app" }, id, parsed.data);
    return NextResponse.json({ column }, { status: 201 });
  } catch (err) {
    return sheetRouteError(err);
  }
}
