import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { logAudit } from "@/lib/audit-log";
import { getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function DELETE(req: Request) {
  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const existing = await prisma.metaAdsConnection.findUnique({ where: { organizationId: access.organizationId } });
    await prisma.metaAdsConnection.deleteMany({ where: { organizationId: access.organizationId } });

    if (existing) {
      await logAudit({
        organizationId: access.organizationId,
        actorUserId: access.userId,
        actorName: access.session.user.name ?? access.session.user.email ?? "?",
        action: "META_ADS_DISCONNECTED",
        targetType: "MetaAdsConnection",
        detail: existing.pageName,
        ip: getClientIp(req),
      });
    }

    return NextResponse.json({ ok: true });
  });
}
