import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireProcessAccess, processScopeWhere } from "@/lib/processes/access";
import { runWithTenant } from "@/lib/tenant-context";
import { notifyProcessRequestCreated } from "@/lib/processes/notify";

export const dynamic = "force-dynamic";

/** Botão "Solicitar" do consultor — avisa o administrativo de algo sobre o cliente, sem precisar de acesso de edição. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireProcessAccess();
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const process = await prisma.process.findFirst({
      where: { id, organizationId: access.organizationId, ...processScopeWhere(access) },
      select: { id: true },
    });
    if (!process) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const requests = await prisma.processRequest.findMany({
      where: { processId: id },
      orderBy: { createdAt: "desc" },
      include: {
        requestedBy: { select: { id: true, name: true } },
        resolvedBy: { select: { id: true, name: true } },
      },
    });
    return NextResponse.json(requests);
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { message } = body as { message?: string };

  const access = await requireProcessAccess();
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  if (!message?.trim()) return NextResponse.json({ error: "Mensagem é obrigatória" }, { status: 400 });

  return runWithTenant(access.organizationId, async () => {
    const process = await prisma.process.findFirst({
      where: { id, organizationId: access.organizationId, ...processScopeWhere(access) },
      include: { contact: { select: { name: true } } },
    });
    if (!process) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const requester = await prisma.user.findUnique({ where: { id: access.userId }, select: { name: true } });

    const request = await prisma.processRequest.create({
      data: {
        processId: id,
        organizationId: access.organizationId,
        message: message.trim(),
        requestedById: access.userId,
      },
      include: { requestedBy: { select: { id: true, name: true } } },
    });

    notifyProcessRequestCreated(access.organizationId, {
      id: request.id,
      processId: id,
      contactName: process.contact.name,
      requesterName: requester?.name ?? "Consultor",
    }).catch((err) => console.error("[processes] falha ao notificar solicitação", err));

    return NextResponse.json(request, { status: 201 });
  });
}
