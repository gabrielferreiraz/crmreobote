import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireProcessAccess } from "@/lib/processes/access";
import { runWithTenant } from "@/lib/tenant-context";
import { bodyErrorResponse, readJson } from "@/lib/read-body";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireProcessAccess();
  if (!access.ok || !access.isAdmin) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  let body: { name?: string; color?: string; isFinal?: boolean; slaBusinessDays?: number | null };
  try {
    body = await readJson(req);
  } catch (err) {
    const response = bodyErrorResponse(err);
    if (response) return response;
    throw err;
  }
  const { name, color, isFinal, slaBusinessDays } = body;

  if (!name?.trim()) return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });

  return runWithTenant(access.organizationId, async () => {
    const pipeline = await prisma.processPipeline.findFirst({
      where: { id, organizationId: access.organizationId },
      include: { stages: true },
    });
    if (!pipeline) return NextResponse.json({ error: "Pipeline não encontrado" }, { status: 404 });

    const maxOrder = Math.max(0, ...pipeline.stages.map((s) => s.order));

    const stage = await prisma.processStage.create({
      data: {
        pipelineId: id,
        name: name.trim(),
        color,
        order: maxOrder + 1,
        isFinal: !!isFinal,
        slaBusinessDays: slaBusinessDays ?? null,
      },
    });

    return NextResponse.json(stage, { status: 201 });
  });
}
