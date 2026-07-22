import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireProcessAccess, processScopeWhere } from "@/lib/processes/access";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

/** Trilha de auditoria — quem moveu de etapa, quando, de onde pra onde. Consultor também enxerga (é o próprio processo dele), nunca edita. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireProcessAccess();
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const process = await prisma.process.findFirst({
      where: { id, organizationId: access.organizationId, ...processScopeWhere(access) },
      select: { id: true },
    });
    if (!process) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const history = await prisma.processStageHistory.findMany({
      where: { processId: id },
      orderBy: { changedAt: "desc" },
      include: {
        toStage: { select: { id: true, name: true, color: true } },
        changedBy: { select: { id: true, name: true } },
      },
    });

    // fromStage é opcional (null na criação) — busca em lote só os nomes que existem, sem N+1.
    const fromStageIds = history.map((h) => h.fromStageId).filter((v): v is string => !!v);
    const fromStages = fromStageIds.length
      ? await prisma.processStage.findMany({ where: { id: { in: fromStageIds } }, select: { id: true, name: true, color: true } })
      : [];
    const fromStageById = new Map(fromStages.map((s) => [s.id, s]));

    return NextResponse.json(
      history.map((h) => ({
        id: h.id,
        changedAt: h.changedAt,
        changedBy: h.changedBy,
        fromStage: h.fromStageId ? (fromStageById.get(h.fromStageId) ?? null) : null,
        toStage: h.toStage,
      })),
    );
  });
}
