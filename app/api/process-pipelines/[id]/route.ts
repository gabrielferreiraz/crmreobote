import { NextResponse } from "next/server";
import { prisma, prismaRaw } from "@/lib/prisma";
import { requireProcessAccess } from "@/lib/processes/access";
import { runWithTenant, setTenantOnTx } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { name, isDefault, categoryId } = body as { name?: string; isDefault?: boolean; categoryId?: string };

  const access = await requireProcessAccess();
  if (!access.ok || !access.isAdmin) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  if (name === undefined && isDefault === undefined && categoryId === undefined) {
    return NextResponse.json({ error: "name, isDefault ou categoryId é obrigatório" }, { status: 400 });
  }
  if (name !== undefined && !name.trim()) {
    return NextResponse.json({ error: "Nome não pode ser vazio" }, { status: 400 });
  }

  return runWithTenant(access.organizationId, async () => {
    const pipeline = await prisma.processPipeline.findFirst({ where: { id, organizationId: access.organizationId } });
    if (!pipeline) return NextResponse.json({ error: "Pipeline não encontrado" }, { status: 404 });

    if (categoryId !== undefined) {
      const category = await prisma.processCategory.findFirst({
        where: { id: categoryId, organizationId: access.organizationId },
      });
      if (!category) return NextResponse.json({ error: "Categoria inválida" }, { status: 400 });
    }

    const updated = await prismaRaw.$transaction(async (tx) => {
      await setTenantOnTx(tx, access.organizationId);

      if (isDefault) {
        await tx.processPipeline.updateMany({
          where: { organizationId: access.organizationId, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.processPipeline.update({
        where: { id },
        data: {
          ...(name !== undefined ? { name: name.trim() } : {}),
          ...(isDefault ? { isDefault: true } : {}),
          ...(categoryId !== undefined ? { categoryId } : {}),
        },
      });
    });

    return NextResponse.json(updated);
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireProcessAccess();
  if (!access.ok || !access.isAdmin) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const pipeline = await prisma.processPipeline.findFirst({
      where: { id, organizationId: access.organizationId },
      include: { _count: { select: { processes: true } } },
    });
    if (!pipeline) return NextResponse.json({ error: "Pipeline não encontrado" }, { status: 404 });

    if (pipeline._count.processes > 0) {
      return NextResponse.json({ error: "Mova os processos dessa subcategoria antes de excluí-la" }, { status: 409 });
    }

    // Sem mais o mínimo "ao menos 1 pipeline pra organização inteira" —
    // agora existem várias Categorias, cada uma podendo ter suas próprias
    // Subcategorias; não faz sentido travar a exclusão da última de uma
    // categoria só porque outra categoria também tem as suas.
    await prismaRaw.$transaction(async (tx) => {
      await setTenantOnTx(tx, access.organizationId);

      await tx.processPipeline.delete({ where: { id } });

      if (pipeline.isDefault) {
        const next = await tx.processPipeline.findFirst({
          where: { organizationId: access.organizationId },
          orderBy: { order: "asc" },
        });
        if (next) await tx.processPipeline.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    });

    return NextResponse.json({ ok: true });
  });
}
