import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { resolveAvatarUrlMap } from "@/lib/r2";

export const dynamic = "force-dynamic";

const MAX_BATCHES = 100;

/**
 * Histórico de importações de CONTATO — mesmo espírito de
 * app/api/deals/import/history/route.ts (rota própria, não a mesma rota
 * filtrada por query param, pra manter a URL de cada tipo de importação sob
 * seu próprio namespace /api/{entidade}/import/*, igual preview/commit já
 * são). Filtra type: "contacts" — sem isso, um ImportBatch de negócio
 * (type: "deals") apareceria aqui também, já que os dois tipos vivem na
 * mesma tabela (ver ImportBatch no schema).
 *
 * Qualquer usuário autenticado acessa, mas cada um vê APENAS os lotes que
 * ele mesmo criou (createdById = userId logado) — mesma regra de negócios.
 */
export async function GET() {
  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const batches = await prisma.importBatch.findMany({
      where: {
        organizationId: access.organizationId,
        type: "contacts",
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
