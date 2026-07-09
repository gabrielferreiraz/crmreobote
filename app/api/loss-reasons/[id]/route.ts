import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { label } = body as { label?: string };

  const access = await requireRole(["OWNER", "ADMIN"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  if (!label?.trim()) return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });

  return runWithTenant(access.organizationId, async () => {
    const reason = await prisma.lossReason.findFirst({
      where: { id, organizationId: access.organizationId },
    });
    if (!reason) return NextResponse.json({ error: "Motivo não encontrado" }, { status: 404 });

    const updated = await prisma.lossReason.update({
      where: { id },
      data: { label: label.trim() },
    });

    return NextResponse.json(updated);
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER", "ADMIN"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const reason = await prisma.lossReason.findFirst({
      where: { id, organizationId: access.organizationId },
      include: { _count: { select: { deals: true } } },
    });
    if (!reason) return NextResponse.json({ error: "Motivo não encontrado" }, { status: 404 });

    if (reason._count.deals > 0) {
      return NextResponse.json(
        { error: "Existem negócios usando este motivo" },
        { status: 409 },
      );
    }

    await prisma.lossReason.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  });
}
