import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireProcessAccess } from "@/lib/processes/access";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { name } = body as { name?: string };

  const access = await requireProcessAccess();
  if (!access.ok || !access.isAdmin) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  if (!name?.trim()) return NextResponse.json({ error: "Nome não pode ser vazio" }, { status: 400 });

  return runWithTenant(access.organizationId, async () => {
    const category = await prisma.processCategory.findFirst({ where: { id, organizationId: access.organizationId } });
    if (!category) return NextResponse.json({ error: "Categoria não encontrada" }, { status: 404 });

    const updated = await prisma.processCategory.update({ where: { id }, data: { name: name.trim() } });
    return NextResponse.json(updated);
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireProcessAccess();
  if (!access.ok || !access.isAdmin) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const category = await prisma.processCategory.findFirst({
      where: { id, organizationId: access.organizationId },
      include: { pipelines: { include: { _count: { select: { processes: true } } } } },
    });
    if (!category) return NextResponse.json({ error: "Categoria não encontrada" }, { status: 404 });

    const totalProcesses = category.pipelines.reduce((sum, p) => sum + p._count.processes, 0);
    if (totalProcesses > 0) {
      return NextResponse.json(
        { error: "Mova os processos das subcategorias dessa categoria antes de excluí-la" },
        { status: 409 },
      );
    }

    // Sem processo em nenhuma subcategoria — a exclusão em cascata (ver
    // schema) já remove as subcategorias/etapas vazias junto.
    await prisma.processCategory.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  });
}
