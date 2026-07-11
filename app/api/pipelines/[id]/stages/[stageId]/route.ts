import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { sanitizeRequiredFields } from "@/lib/deal-required-fields";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; stageId: string }> },
) {
  const { id, stageId } = await params;
  const body = await req.json();
  const { name, color, requiredFields } = body as { name?: string; color?: string; requiredFields?: unknown };

  const access = await requireRole(["OWNER", "ADMIN"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const stage = await prisma.pipelineStage.findFirst({
      where: { id: stageId, pipelineId: id, pipeline: { organizationId: access.organizationId } },
    });
    if (!stage) return NextResponse.json({ error: "Etapa não encontrada" }, { status: 404 });

    const updated = await prisma.pipelineStage.update({
      where: { id: stageId },
      data: {
        name: name?.trim() || undefined,
        color,
        requiredFields: requiredFields !== undefined ? sanitizeRequiredFields(requiredFields) : undefined,
      },
    });

    return NextResponse.json(updated);
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; stageId: string }> },
) {
  const { id, stageId } = await params;

  const access = await requireRole(["OWNER", "ADMIN"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const stage = await prisma.pipelineStage.findFirst({
      where: { id: stageId, pipelineId: id, pipeline: { organizationId: access.organizationId } },
      include: { _count: { select: { deals: true } } },
    });
    if (!stage) return NextResponse.json({ error: "Etapa não encontrada" }, { status: 404 });

    if (stage._count.deals > 0) {
      return NextResponse.json(
        { error: "Mova ou encerre os negócios desta etapa antes de excluí-la" },
        { status: 409 },
      );
    }

    await prisma.pipelineStage.delete({ where: { id: stageId } });
    return NextResponse.json({ ok: true });
  });
}
