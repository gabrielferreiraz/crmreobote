import { NextResponse } from "next/server";
import { prisma, prismaRaw } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant, setTenantOnTx } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { stageIds } = body as { stageIds?: string[] };

  const access = await requireRole(["OWNER", "ADMIN"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const pipeline = await prisma.pipeline.findFirst({
      where: { id, organizationId: access.organizationId },
      include: { stages: true },
    });
    if (!pipeline) return NextResponse.json({ error: "Pipeline não encontrado" }, { status: 404 });

    const validIds = new Set(pipeline.stages.map((s) => s.id));
    if (!Array.isArray(stageIds) || stageIds.some((sid) => !validIds.has(sid))) {
      return NextResponse.json({ error: "stageIds inválido" }, { status: 400 });
    }

    await prismaRaw.$transaction(async (tx) => {
      await setTenantOnTx(tx, access.organizationId);
      for (const [index, stageId] of stageIds.entries()) {
        await tx.pipelineStage.update({ where: { id: stageId }, data: { order: index + 1 } });
      }
    });

    return NextResponse.json({ ok: true });
  });
}
