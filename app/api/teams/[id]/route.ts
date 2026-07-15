import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { name, leaderId, managerId } = body as { name?: string; leaderId?: string | null; managerId?: string | null };

  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const team = await prisma.team.findFirst({
      where: { id, organizationId: access.organizationId },
    });
    if (!team) return NextResponse.json({ error: "Equipe não encontrada" }, { status: 404 });

    if (leaderId) {
      const membership = await prisma.organizationUser.findUnique({
        where: { organizationId_userId: { organizationId: access.organizationId, userId: leaderId } },
      });
      if (!membership || membership.role !== "SUPERVISOR") {
        return NextResponse.json(
          { error: "O líder precisa ser um usuário com papel de Supervisor" },
          { status: 400 },
        );
      }
    }

    if (managerId) {
      const membership = await prisma.organizationUser.findUnique({
        where: { organizationId_userId: { organizationId: access.organizationId, userId: managerId } },
      });
      if (!membership || membership.role !== "MANAGER") {
        return NextResponse.json(
          { error: "O gerente precisa ser um usuário com papel de Gerente" },
          { status: 400 },
        );
      }
    }

    const updated = await prisma.team.update({
      where: { id },
      data: {
        name: name?.trim() || undefined,
        leaderId: leaderId === undefined ? undefined : leaderId,
        managerId: managerId === undefined ? undefined : managerId,
      },
      include: {
        leader: { select: { id: true, name: true } },
        manager: { select: { id: true, name: true } },
        members: { include: { user: { select: { id: true, name: true, email: true } } } },
      },
    });

    return NextResponse.json(updated);
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const team = await prisma.team.findFirst({
      where: { id, organizationId: access.organizationId },
    });
    if (!team) return NextResponse.json({ error: "Equipe não encontrada" }, { status: 404 });

    await prisma.team.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  });
}
