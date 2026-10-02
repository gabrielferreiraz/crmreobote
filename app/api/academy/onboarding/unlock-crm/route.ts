import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAcademyToken } from "@/lib/require-academy-token";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { runWithTenant } from "@/lib/tenant-context";
import { logAudit } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

/**
 * Chamado pelo backend da Academy quando o consultor chega ao modulo de CRM.
 * O usuario vem exclusivamente do access token opaco; nao aceitamos userId,
 * empresa ou estado no corpo da requisicao.
 */
export async function POST(req: Request) {
  const access = await requireAcademyToken(req);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const rateLimited = rateLimitOrResponse(`academy:${access.userId}:unlock-crm`, 10, 60_000);
  if (rateLimited) return rateLimited;

  const result = await runWithTenant(access.organizationId, async () => {
    const updated = await prisma.organizationUser.updateMany({
      where: {
        organizationId: access.organizationId,
        userId: access.userId,
        active: true,
        role: "MEMBER",
        area: "VENDAS",
        academyOnboardingStatus: { in: ["REQUIRED", "STARTED"] },
      },
      data: { academyOnboardingStatus: "CRM_UNLOCKED" },
    });

    const membership = await prisma.organizationUser.findUnique({
      where: {
        organizationId_userId: {
          organizationId: access.organizationId,
          userId: access.userId,
        },
      },
      select: { academyOnboardingStatus: true },
    });

    return { changed: updated.count > 0, status: membership?.academyOnboardingStatus ?? null };
  });

  if (result.changed) {
    await logAudit({
      organizationId: access.organizationId,
      actorUserId: access.userId,
      actorName: "Reobote Academy",
      action: "ACADEMY_CRM_UNLOCKED",
      targetType: "User",
      targetId: access.userId,
      detail: `${access.name}: chegou ao modulo de CRM`,
    });
  }

  return NextResponse.json(
    { unlocked: result.status === "CRM_UNLOCKED" || result.status === "NOT_REQUIRED", status: result.status },
    { headers: { "Cache-Control": "no-store" } },
  );
}
