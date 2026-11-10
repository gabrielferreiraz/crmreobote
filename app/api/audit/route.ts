import { NextResponse } from "next/server";
import { requireRole } from "@/lib/require-role";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { AUDIT_PAGE_SIZE, filtersFromParams, queryAudit } from "@/lib/audit-query";

export const dynamic = "force-dynamic";

/** Trilha de auditoria da organização (só o Dono): filtros + paginação por cursor. */
export async function GET(req: Request) {
  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const limited = rateLimitOrResponse(`audit-query:${access.userId}`, 120, 60_000);
  if (limited) return limited;

  const params = new URL(req.url).searchParams;
  const limit = Number(params.get("limit")) || AUDIT_PAGE_SIZE;
  const result = await queryAudit(access.organizationId, filtersFromParams(params), { cursor: params.get("cursor") ?? undefined, limit });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
