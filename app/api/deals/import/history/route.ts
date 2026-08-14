import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { resolveAvatarUrlMap } from "@/lib/r2";

export const dynamic = "force-dynamic";

const MAX_BATCHES = 100;

/** Histórico de importações — consultado pelo modal aberto na própria página de Pipeline (ver components/import-history-dialog.tsx). Lista fica enxuta de propósito (sem issueRows, que pode ser grande) — detalhe completo é GET /api/deals/import/[id], sob demanda. */
export async function GET() {
  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const batches = await prisma.importBatch.findMany({
      where: { organizationId: access.organizationId },
      orderBy: { createdAt: "desc" },
      take: MAX_BATCHES,
      include: { createdBy: { select: { name: true, image: true } } },
    });

    const avatarMap = await resolveAvatarUrlMap(batches.map((b) => b.createdBy.image));

    return NextResponse.json(
      batches.map((b) => ({
        id: b.id,
        type: b.type,
        fileName: b.fileName,
        rowsTotal: b.rowsTotal,
        rowsCreated: b.rowsCreated,
        rowsSkipped: b.rowsSkipped,
        createdAt: b.createdAt,
        deletedAt: b.deletedAt,
        createdBy: {
          name: b.createdBy.name,
          photoUrl: b.createdBy.image ? (avatarMap.get(b.createdBy.image) ?? null) : null,
        },
      })),
    );
  });
}
