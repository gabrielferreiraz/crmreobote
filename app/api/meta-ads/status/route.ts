import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const connection = await prisma.metaAdsConnection.findUnique({
      where: { organizationId: access.organizationId },
      select: {
        pageName: true,
        pixelId: true,
        createdAt: true,
        adAccountId: true,
        adAccountName: true,
        // Nunca o token em si — só se ele existe, pra UI saber se precisa
        // pedir reconexão antes de deixar escolher Ad Account (ver
        // meta-ads-connect.tsx).
        userAccessTokenEncrypted: true,
      },
    });
    return NextResponse.json({
      connected: !!connection,
      pageName: connection?.pageName ?? null,
      pixelId: connection?.pixelId ?? null,
      adAccountId: connection?.adAccountId ?? null,
      adAccountName: connection?.adAccountName ?? null,
      hasInsightsToken: !!connection?.userAccessTokenEncrypted,
    });
  });
}
