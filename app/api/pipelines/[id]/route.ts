import { NextResponse } from "next/server";
import { prisma, prismaRaw } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant, setTenantOnTx } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { name, isDefault } = body as { name?: string; isDefault?: boolean };

  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  if (name === undefined && isDefault === undefined) {
    return NextResponse.json({ error: "name ou isDefault é obrigatório" }, { status: 400 });
  }
  if (name !== undefined && !name.trim()) {
    return NextResponse.json({ error: "Nome não pode ser vazio" }, { status: 400 });
  }

  return runWithTenant(access.organizationId, async () => {
    const pipeline = await prisma.pipeline.findFirst({
      where: { id, organizationId: access.organizationId },
    });
    if (!pipeline) return NextResponse.json({ error: "Pipeline não encontrado" }, { status: 404 });

    const updated = await prismaRaw.$transaction(async (tx) => {
      await setTenantOnTx(tx, access.organizationId);

      if (isDefault) {
        await tx.pipeline.updateMany({
          where: { organizationId: access.organizationId, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.pipeline.update({
        where: { id },
        data: { ...(name !== undefined ? { name: name.trim() } : {}), ...(isDefault ? { isDefault: true } : {}) },
      });
    });

    return NextResponse.json(updated);
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const pipeline = await prisma.pipeline.findFirst({
      where: { id, organizationId: access.organizationId },
      include: { _count: { select: { deals: true } } },
    });
    if (!pipeline) return NextResponse.json({ error: "Pipeline não encontrado" }, { status: 404 });

    if (pipeline._count.deals > 0) {
      return NextResponse.json(
        { error: "Mova ou exclua os negócios dessa pipeline antes de excluí-la" },
        { status: 409 },
      );
    }

    const totalPipelines = await prisma.pipeline.count({ where: { organizationId: access.organizationId } });
    if (totalPipelines <= 1) {
      return NextResponse.json(
        { error: "A organização precisa de ao menos uma pipeline" },
        { status: 409 },
      );
    }

    await prismaRaw.$transaction(async (tx) => {
      await setTenantOnTx(tx, access.organizationId);

      await tx.pipeline.delete({ where: { id } });

      if (pipeline.isDefault) {
        const next = await tx.pipeline.findFirst({
          where: { organizationId: access.organizationId },
          orderBy: { order: "asc" },
        });
        if (next) {
          await tx.pipeline.update({ where: { id: next.id }, data: { isDefault: true } });
        }
      }
    });

    return NextResponse.json({ ok: true });
  });
}
