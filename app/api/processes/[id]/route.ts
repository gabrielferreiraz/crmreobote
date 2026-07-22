import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireProcessAccess, processScopeWhere } from "@/lib/processes/access";
import { runWithTenant } from "@/lib/tenant-context";
import type { $Enums } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireProcessAccess();
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const process = await prisma.process.findFirst({
      where: { id, organizationId: access.organizationId, ...processScopeWhere(access) },
      include: {
        contact: true,
        owner: { select: { id: true, name: true } },
        stage: { select: { id: true, name: true, color: true } },
        pipeline: { include: { stages: { orderBy: { order: "asc" } } } },
        deal: { select: { id: true, name: true, value: true, closedAt: true } },
      },
    });
    if (!process) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    return NextResponse.json({
      ...process,
      deal: { ...process.deal, value: process.deal.value != null ? Number(process.deal.value) : null },
    });
  });
}

/** Só os marcadores — mover de etapa é uma ação à parte (ver /move, precisa gravar auditoria). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { contemplated, paymentPending, documentStatus, quotaNumber, groupNumber } = body as {
    contemplated?: boolean;
    paymentPending?: boolean;
    documentStatus?: string;
    quotaNumber?: string | null;
    groupNumber?: string | null;
  };

  const access = await requireProcessAccess();
  if (!access.ok || !access.isAdmin) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const validDocumentStatuses: $Enums.DocumentStatus[] = ["NOT_REQUESTED", "PENDING_DELIVERY", "DELIVERED"];
  if (documentStatus !== undefined && !validDocumentStatuses.includes(documentStatus as $Enums.DocumentStatus)) {
    return NextResponse.json({ error: "documentStatus inválido" }, { status: 400 });
  }

  return runWithTenant(access.organizationId, async () => {
    const existing = await prisma.process.findFirst({ where: { id, organizationId: access.organizationId } });
    if (!existing) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const updated = await prisma.process.update({
      where: { id },
      data: {
        ...(contemplated !== undefined ? { contemplated } : {}),
        ...(paymentPending !== undefined ? { paymentPending } : {}),
        ...(documentStatus !== undefined ? { documentStatus: documentStatus as $Enums.DocumentStatus } : {}),
        ...(quotaNumber !== undefined ? { quotaNumber: quotaNumber?.trim() || null } : {}),
        ...(groupNumber !== undefined ? { groupNumber: groupNumber?.trim() || null } : {}),
      },
      include: { contact: true, owner: { select: { id: true, name: true } }, stage: true },
    });

    return NextResponse.json(updated);
  });
}
