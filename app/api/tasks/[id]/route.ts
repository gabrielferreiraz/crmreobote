import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { getDealScope, scopeWhere } from "@/lib/team-scope";
import { runWithTenant } from "@/lib/tenant-context";
import { recordUserChange } from "@/lib/user-activity";

export const dynamic = "force-dynamic";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { title, description, dueAt, completed } = body as {
    title?: string;
    description?: string;
    dueAt?: string | null;
    completed?: boolean;
  };

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(access.organizationId, async () => {
    const scope = await getDealScope(access.organizationId, access.userId, access.role);
    const existing = await prisma.task.findFirst({
      where: { id, organizationId: access.organizationId, ...scopeWhere(scope) },
    });
    if (!existing) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const task = await prisma.task.update({
      where: { id },
      data: {
        title,
        description,
        dueAt: dueAt === undefined ? undefined : dueAt ? new Date(dueAt) : null,
        completedAt: completed === undefined ? undefined : completed ? new Date() : null,
      },
      include: { deal: true, contact: true, owner: true },
    });

    recordUserChange(access.organizationId, access.userId).catch((err) =>
      console.error("[user-activity] falha ao registrar alteração", err),
    );

    return NextResponse.json(task);
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(access.organizationId, async () => {
    const scope = await getDealScope(access.organizationId, access.userId, access.role);
    const existing = await prisma.task.findFirst({
      where: { id, organizationId: access.organizationId, ...scopeWhere(scope) },
    });
    if (!existing) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    await prisma.task.delete({ where: { id } });
    recordUserChange(access.organizationId, access.userId).catch((err) =>
      console.error("[user-activity] falha ao registrar alteração", err),
    );
    return NextResponse.json({ ok: true });
  });
}
