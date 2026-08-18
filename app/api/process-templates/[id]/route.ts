import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireProcessAccess } from "@/lib/processes/access";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const { name, message } = (body ?? {}) as { name?: string; message?: string };

  const access = await requireProcessAccess();
  if (!access.ok || !access.isAdmin) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const existing = await prisma.processTemplate.findFirst({ where: { id, organizationId: access.organizationId } });
    if (!existing) return NextResponse.json({ error: "Modelo não encontrado" }, { status: 404 });

    const updated = await prisma.processTemplate.update({
      where: { id },
      data: { name: name?.trim() || undefined, message: message?.trim() || undefined },
    });
    return NextResponse.json(updated);
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireProcessAccess();
  if (!access.ok || !access.isAdmin) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const existing = await prisma.processTemplate.findFirst({ where: { id, organizationId: access.organizationId } });
    if (!existing) return NextResponse.json({ error: "Modelo não encontrado" }, { status: 404 });

    // Apaga junto o histórico de uso deste modelo (ver onDelete: Cascade no
    // schema) — perde só a estatística de ranking, nunca os
    // ProcessRequest/mensagens de WhatsApp já enviados (esses guardam o
    // texto final por conta própria, não uma referência ao modelo).
    await prisma.processTemplate.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  });
}
