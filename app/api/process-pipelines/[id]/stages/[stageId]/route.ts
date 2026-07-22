import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireProcessAccess } from "@/lib/processes/access";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; stageId: string }> }) {
  const { id, stageId } = await params;
  const body = await req.json();
  const { name, color, isFinal } = body as { name?: string; color?: string; isFinal?: boolean };

  const access = await requireProcessAccess();
  if (!access.ok || !access.isAdmin) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const stage = await prisma.processStage.findFirst({
      where: { id: stageId, pipelineId: id, pipeline: { organizationId: access.organizationId } },
    });
    if (!stage) return NextResponse.json({ error: "Etapa não encontrada" }, { status: 404 });

    const updated = await prisma.processStage.update({
      where: { id: stageId },
      data: {
        name: name?.trim() || undefined,
        color,
        isFinal: isFinal !== undefined ? isFinal : undefined,
      },
    });

    return NextResponse.json(updated);
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; stageId: string }> }) {
  const { id, stageId } = await params;

  const access = await requireProcessAccess();
  if (!access.ok || !access.isAdmin) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const stage = await prisma.processStage.findFirst({
      where: { id: stageId, pipelineId: id, pipeline: { organizationId: access.organizationId } },
      include: { _count: { select: { processes: true } } },
    });
    if (!stage) return NextResponse.json({ error: "Etapa não encontrada" }, { status: 404 });

    if (stage._count.processes > 0) {
      return NextResponse.json({ error: "Mova os processos desta etapa antes de excluí-la" }, { status: 409 });
    }

    await prisma.processStage.delete({ where: { id: stageId } });
    return NextResponse.json({ ok: true });
  });
}
