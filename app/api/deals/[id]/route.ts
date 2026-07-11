import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { sanitizeCell } from "@/lib/csv-sanitize";
import { runWithTenant } from "@/lib/tenant-context";
import { labelForRequiredField, type RequirableDealField } from "@/lib/deal-required-fields";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { organizationId } = await requireSession();
  if (!organizationId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const deal = await prisma.deal.findFirst({
      where: { id, organizationId },
      include: {
        contact: true,
        owner: true,
        stage: true,
        pipeline: { include: { stages: { orderBy: { order: "asc" } } } },
        activities: { orderBy: { createdAt: "desc" }, include: { user: true } },
        tasks: { orderBy: { dueAt: "asc" } },
        lossReason: true,
      },
    });

    if (!deal) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    return NextResponse.json(deal);
  });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const {
    name,
    status,
    value,
    creditType,
    creditTerm,
    groupNumber,
    quota,
    contemplated,
    description,
    lossReasonId,
    lostReason,
    expectedCloseAt,
    ownerId,
  } = body as {
    name?: string;
    status?: "OPEN" | "WON" | "LOST";
    value?: number | null;
    creditType?: string | null;
    creditTerm?: number | null;
    groupNumber?: string | null;
    quota?: string | null;
    contemplated?: boolean;
    description?: string | null;
    lossReasonId?: string | null;
    lostReason?: string | null;
    expectedCloseAt?: string | null;
    ownerId?: string;
  };

  const { organizationId } = await requireSession();
  if (!organizationId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const existing = await prisma.deal.findFirst({ where: { id, organizationId } });
    if (!existing) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    if (ownerId) {
      const membership = await prisma.organizationUser.findUnique({
        where: { organizationId_userId: { organizationId, userId: ownerId } },
      });
      if (!membership) return NextResponse.json({ error: "Responsável inválido" }, { status: 400 });
    }

    if (lossReasonId) {
      const reason = await prisma.lossReason.findFirst({
        where: { id: lossReasonId, organizationId },
      });
      if (!reason) return NextResponse.json({ error: "Motivo de perda inválido" }, { status: 400 });
    }

    if (status === "LOST" && !lossReasonId && !existing.lossReasonId) {
      return NextResponse.json({ error: "Selecione um motivo de perda" }, { status: 400 });
    }

    // Mesma regra do /move: se a etapa atual exige algum desses campos, não
    // pode limpá-lo por aqui — sem essa checagem dava pra contornar a
    // exigência do /move simplesmente apagando o campo depois nesta rota.
    const clearedFields = (
      [
        ["value", value],
        ["creditType", creditType],
        ["creditTerm", creditTerm],
        ["groupNumber", groupNumber],
        ["quota", quota],
        ["expectedCloseAt", expectedCloseAt],
      ] as const
    )
      .filter(([, v]) => v === null)
      .map(([field]) => field as RequirableDealField);

    if (clearedFields.length > 0) {
      const currentStage = await prisma.pipelineStage.findUnique({ where: { id: existing.stageId } });
      const blocked = clearedFields.filter((field) => currentStage?.requiredFields.includes(field));
      if (blocked.length > 0) {
        return NextResponse.json(
          { error: `Esta etapa exige: ${blocked.map(labelForRequiredField).join(", ")}` },
          { status: 400 },
        );
      }
    }

    const closedAt =
      status && status !== "OPEN" && existing.status === "OPEN" ? new Date() : undefined;

    const deal = await prisma.deal.update({
      where: { id },
      data: {
        name: sanitizeCell(name),
        status,
        value,
        creditType: sanitizeCell(creditType),
        creditTerm,
        groupNumber: sanitizeCell(groupNumber),
        quota: sanitizeCell(quota),
        contemplated,
        description: sanitizeCell(description),
        lossReasonId,
        lostReason: sanitizeCell(lostReason),
        ownerId,
        expectedCloseAt: expectedCloseAt ? new Date(expectedCloseAt) : undefined,
        ...(closedAt ? { closedAt } : {}),
      },
      include: { contact: true, owner: true, stage: true, lossReason: true },
    });

    return NextResponse.json(deal);
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { organizationId } = await requireSession();
  if (!organizationId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const existing = await prisma.deal.findFirst({ where: { id, organizationId } });
    if (!existing) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    await prisma.deal.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  });
}
