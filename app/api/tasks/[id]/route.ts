import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";

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

  const { organizationId } = await requireSession();
  if (!organizationId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const existing = await prisma.task.findFirst({ where: { id, organizationId } });
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

    return NextResponse.json(task);
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { organizationId } = await requireSession();
  if (!organizationId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const existing = await prisma.task.findFirst({ where: { id, organizationId } });
    if (!existing) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    await prisma.task.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  });
}
