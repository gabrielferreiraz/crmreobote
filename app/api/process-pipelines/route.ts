import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireProcessAccess } from "@/lib/processes/access";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireProcessAccess();
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const pipelines = await prisma.processPipeline.findMany({
      where: { organizationId: access.organizationId },
      orderBy: { order: "asc" },
      include: { stages: { orderBy: { order: "asc" } } },
    });
    return NextResponse.json(pipelines);
  });
}

/** Cria uma Subcategoria (nome interno "pipeline", ver comentário no schema) dentro de uma Categoria. */
export async function POST(req: Request) {
  const body = await req.json();
  const { name, categoryId } = body as { name?: string; categoryId?: string };

  const access = await requireProcessAccess();
  if (!access.ok || !access.isAdmin) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  if (!name?.trim()) return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });
  if (!categoryId) return NextResponse.json({ error: "categoryId é obrigatório" }, { status: 400 });

  return runWithTenant(access.organizationId, async () => {
    const category = await prisma.processCategory.findFirst({
      where: { id: categoryId, organizationId: access.organizationId },
    });
    if (!category) return NextResponse.json({ error: "Categoria inválida" }, { status: 400 });

    const last = await prisma.processPipeline.findFirst({
      where: { organizationId: access.organizationId, categoryId },
      orderBy: { order: "desc" },
      select: { order: true },
    });

    const pipeline = await prisma.processPipeline.create({
      data: {
        organizationId: access.organizationId,
        categoryId,
        name: name.trim(),
        isDefault: false,
        order: (last?.order ?? 0) + 1,
        stages: { create: [{ name: "Nova etapa", order: 1, color: "#6366f1" }] },
      },
      include: { stages: { orderBy: { order: "asc" } } },
    });

    return NextResponse.json(pipeline, { status: 201 });
  });
}
