import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireProcessAccess, processScopeWhere } from "@/lib/processes/access";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireProcessAccess();
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const process = await prisma.process.findFirst({
      where: { id, organizationId: access.organizationId, ...processScopeWhere(access) },
    });
    if (!process) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const activities = await prisma.activity.findMany({
      where: { processId: id },
      orderBy: { createdAt: "desc" },
      include: { user: { select: { id: true, name: true } } },
    });

    return NextResponse.json(activities);
  });
}

/** Só o administrativo registra anotações de Processo — consultor usa o botão de Solicitação. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { activityBody } = body as { activityBody?: string };

  if (!activityBody?.trim()) return NextResponse.json({ error: "Nota vazia" }, { status: 400 });

  const access = await requireProcessAccess();
  if (!access.ok || !access.isAdmin) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const process = await prisma.process.findFirst({ where: { id, organizationId: access.organizationId } });
    if (!process) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const activity = await prisma.activity.create({
      data: {
        organizationId: access.organizationId,
        processId: id,
        contactId: process.contactId,
        userId: access.userId,
        type: "NOTE",
        body: activityBody.trim(),
      },
      include: { user: { select: { id: true, name: true } } },
    });

    return NextResponse.json(activity, { status: 201 });
  });
}
