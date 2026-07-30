import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

// Só o suficiente pra investigar um incidente recente sem carregar a
// organização inteira — busca/filtro (ver audit-log-view.tsx) é sempre
// client-side sobre esse recorte, igual ao backup de WhatsApp.
const MAX_LOGS = 500;

export async function GET() {
  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const logs = await prisma.auditLog.findMany({
      where: { organizationId: access.organizationId },
      orderBy: { createdAt: "desc" },
      take: MAX_LOGS,
    });

    return NextResponse.json(
      logs.map((l) => ({
        id: l.id,
        actorName: l.actorName,
        action: l.action,
        targetType: l.targetType,
        targetId: l.targetId,
        detail: l.detail,
        ip: l.ip,
        createdAt: l.createdAt.toISOString(),
      })),
    );
  });
}
