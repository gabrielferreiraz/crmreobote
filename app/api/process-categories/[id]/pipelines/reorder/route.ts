import { NextResponse } from "next/server";
import { prisma, prismaRaw } from "@/lib/prisma";
import { requireProcessAccess } from "@/lib/processes/access";
import { runWithTenant, setTenantOnTx } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

/** Reordena as Subcategorias (ProcessPipeline) DENTRO de uma Categoria. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { pipelineIds } = body as { pipelineIds?: string[] };

  const access = await requireProcessAccess();
  if (!access.ok || !access.isAdmin) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const pipelines = await prisma.processPipeline.findMany({
      where: { categoryId: id, organizationId: access.organizationId },
    });
    const validIds = new Set(pipelines.map((p) => p.id));
    if (!Array.isArray(pipelineIds) || pipelineIds.some((pid) => !validIds.has(pid))) {
      return NextResponse.json({ error: "pipelineIds inválido" }, { status: 400 });
    }

    await prismaRaw.$transaction(async (tx) => {
      await setTenantOnTx(tx, access.organizationId);
      for (const [index, pipelineId] of pipelineIds.entries()) {
        await tx.processPipeline.update({ where: { id: pipelineId }, data: { order: index } });
      }
    });

    return NextResponse.json({ ok: true });
  });
}
