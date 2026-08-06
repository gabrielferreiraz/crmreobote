import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireProcessAccess } from "@/lib/processes/access";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireProcessAccess();
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const categories = await prisma.processCategory.findMany({
      where: { organizationId: access.organizationId },
      orderBy: { order: "asc" },
      include: { pipelines: { orderBy: { order: "asc" }, include: { stages: { orderBy: { order: "asc" } } } } },
    });
    return NextResponse.json(categories);
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const { name } = body as { name?: string };

  const access = await requireProcessAccess();
  if (!access.ok || !access.isAdmin) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  if (!name?.trim()) return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });

  return runWithTenant(access.organizationId, async () => {
    const last = await prisma.processCategory.findFirst({
      where: { organizationId: access.organizationId },
      orderBy: { order: "desc" },
      select: { order: true },
    });

    // Categoria nasce com uma Subcategoria de exemplo — evita a tela de
    // configuração mostrar uma categoria "vazia" logo após criada, e o
    // Kanban sempre tem alguma coluna pra mostrar assim que se troca pra ela.
    const category = await prisma.processCategory.create({
      data: {
        organizationId: access.organizationId,
        name: name.trim(),
        order: (last?.order ?? 0) + 1,
        pipelines: {
          create: [
            {
              organizationId: access.organizationId,
              name: "Nova subcategoria",
              order: 0,
              stages: { create: [{ name: "Nova etapa", order: 1, color: "#6366f1" }] },
            },
          ],
        },
      },
      include: { pipelines: { include: { stages: { orderBy: { order: "asc" } } } } },
    });

    return NextResponse.json(category, { status: 201 });
  });
}
