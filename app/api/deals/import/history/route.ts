import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { resolveAvatarUrlMap } from "@/lib/r2";

export const dynamic = "force-dynamic";

const MAX_BATCHES = 100;

/**
 * Histórico de importações — qualquer usuário autenticado acessa, mas cada
 * um vê APENAS os lotes que ele mesmo criou (createdById = userId logado).
 * Se um dono/TI importou e atribuiu os negócios a outro consultor, o
 * consultor NÃO vê o lote — ele já enxerga os negócios no pipeline dele;
 * o lote de importação é restrito a quem clicou em "Importar".
 */
export async function GET() {
  // requireRole sem lista de roles = qualquer papel autenticado na organização
  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const batches = await prisma.importBatch.findMany({
      where: {
        organizationId: access.organizationId,
        // Cada usuário vê apenas os lotes que ele próprio importou
        createdById: access.userId,
      },
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
