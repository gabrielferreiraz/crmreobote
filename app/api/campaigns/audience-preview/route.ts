import { NextResponse } from "next/server";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { parseAudienceFilter, audienceFilterIsEmpty, countAudience } from "@/lib/campaigns/audience";
import { getDealScope } from "@/lib/team-scope";
import { readJsonObjectOrError } from "@/lib/read-body";

export const dynamic = "force-dynamic";

/** Chamado pelo modal de campanha (criação/edição) pra mostrar quantos contatos batem com o público antes de salvar. */
export async function POST(req: Request) {
  const body = await readJsonObjectOrError(req);
  if (body instanceof NextResponse) return body;

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const filter = parseAudienceFilter(body?.audienceFilter);
  if (audienceFilterIsEmpty(filter)) return NextResponse.json({ count: 0 });

  return runWithTenant(access.organizationId, async () => {
    const scope = await getDealScope(access.organizationId, access.userId, access.role);
    const count = await countAudience(access.organizationId, filter, scope);
    return NextResponse.json({ count });
  });
}
