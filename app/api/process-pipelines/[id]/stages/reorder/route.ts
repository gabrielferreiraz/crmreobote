import { NextResponse } from "next/server";
import { prisma, prismaRaw } from "@/lib/prisma";
import { requireProcessAccess } from "@/lib/processes/access";
import { runWithTenant, setTenantOnTx } from "@/lib/tenant-context";
import { bodyErrorResponse, readJson } from "@/lib/read-body";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireProcessAccess();
  if (!access.ok || !access.isAdmin) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  let body: { stageIds?: string[] };
  try {
    body = await readJson(req);
  } catch (err) {
    const response = bodyErrorResponse(err);
    if (response) return response;
    throw err;
  }
  const { stageIds } = body;

  return runWithTenant(access.organizationId, async () => {
    const pipeline = await prisma.processPipeline.findFirst({
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
        await tx.processStage.update({ where: { id: stageId }, data: { order: index + 1 } });
      }
    });

    return NextResponse.json({ ok: true });
  });
}
