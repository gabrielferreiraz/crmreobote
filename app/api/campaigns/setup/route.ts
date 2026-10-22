import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { getDealScope } from "@/lib/team-scope";
import { listAudienceOptions } from "@/lib/campaigns/audience";

export const dynamic = "force-dynamic";

/** Dados usados somente pelo formulario de criacao ou edicao. */
export async function GET() {
  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(access.organizationId, async () => {
    const scope = await getDealScope(access.organizationId, access.userId, access.role);
    const [scripts, audienceOptions] = await Promise.all([
      prisma.messageScript.findMany({
        where: {
          organizationId: access.organizationId,
          ...(access.role === "OWNER"
            ? {}
            : { OR: [{ visibility: "PUBLIC" as const }, { createdById: access.userId }] }),
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true, steps: true },
      }),
      listAudienceOptions(access.organizationId, scope),
    ]);

    return NextResponse.json(
      { scripts, audienceOptions },
      { headers: { "Cache-Control": "private, max-age=30" } },
    );
  });
}
