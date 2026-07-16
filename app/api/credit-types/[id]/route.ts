import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { label } = body as { label?: string };

  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  if (!label?.trim()) return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });

  return runWithTenant(access.organizationId, async () => {
    const creditType = await prisma.creditType.findFirst({
      where: { id, organizationId: access.organizationId },
    });
    if (!creditType) return NextResponse.json({ error: "Tipo de crédito não encontrado" }, { status: 404 });

    const updated = await prisma.creditType.update({
      where: { id },
      data: { label: label.trim() },
    });

    return NextResponse.json(updated);
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const creditType = await prisma.creditType.findFirst({
      where: { id, organizationId: access.organizationId },
    });
    if (!creditType) return NextResponse.json({ error: "Tipo de crédito não encontrado" }, { status: 404 });

    // Não é FK — checa quantos negócios usam esse texto exato antes de excluir.
    const dealCount = await prisma.deal.count({
      where: { organizationId: access.organizationId, creditType: creditType.label },
    });
    if (dealCount > 0) {
      return NextResponse.json(
        { error: "Existem negócios usando este tipo de crédito" },
        { status: 409 },
      );
    }

    await prisma.creditType.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  });
}
