import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

/** Pixel ID (Events Manager) — colado manualmente, não faz parte do login OAuth (pertence a uma Ad Account, não a uma Página). */
export async function PATCH(req: Request) {
  const { pixelId } = (await req.json().catch(() => ({}))) as { pixelId?: string | null };

  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const connection = await prisma.metaAdsConnection.findUnique({ where: { organizationId: access.organizationId } });
    if (!connection) return NextResponse.json({ error: "Conecte o Facebook primeiro" }, { status: 404 });

    const updated = await prisma.metaAdsConnection.update({
      where: { organizationId: access.organizationId },
      data: { pixelId: pixelId?.trim() || null },
    });
    return NextResponse.json({ pixelId: updated.pixelId });
  });
}
