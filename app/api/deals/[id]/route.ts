import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { getDealScope, scopeWhere } from "@/lib/team-scope";
import { sanitizeCell } from "@/lib/csv-sanitize";
import { runWithTenant } from "@/lib/tenant-context";
import { labelForRequiredField, type RequirableDealField } from "@/lib/deal-required-fields";
import { formatCurrency } from "@/lib/format";
import { enqueueWebhookEvent, buildDealWebhookPayload } from "@/lib/webhooks/enqueue";
import { validateCustomFieldValues } from "@/lib/custom-fields";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(access.organizationId, async () => {
    const scope = await getDealScope(access.organizationId, access.userId, access.role);
    const deal = await prisma.deal.findFirst({
      where: { id, organizationId: access.organizationId, ...scopeWhere(scope) },
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
    description,
    lossReasonId,
    lostReason,
    expectedCloseAt,
    ownerId,
    customFieldValues,
  } = body as {
    name?: string;
    status?: "OPEN" | "WON" | "LOST";
    value?: number | null;
    creditType?: string | null;
    description?: string | null;
    lossReasonId?: string | null;
    lostReason?: string | null;
    expectedCloseAt?: string | null;
    ownerId?: string;
    customFieldValues?: Record<string, unknown>;
  };

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { organizationId, userId } = access;

  return runWithTenant(organizationId, async () => {
    const scope = await getDealScope(organizationId, userId, access.role);
    const existing = await prisma.deal.findFirst({ where: { id, organizationId, ...scopeWhere(scope) } });
    if (!existing) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    if (ownerId) {
      const membership = await prisma.organizationUser.findUnique({
        where: { organizationId_userId: { organizationId, userId: ownerId } },
      });
      if (!membership) return NextResponse.json({ error: "Responsável inválido" }, { status: 400 });
    }

    let lossReasonLabel: string | null = null;
    if (lossReasonId) {
      const reason = await prisma.lossReason.findFirst({
        where: { id: lossReasonId, organizationId },
      });
      if (!reason) return NextResponse.json({ error: "Motivo de perda inválido" }, { status: 400 });
      lossReasonLabel = reason.label;
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

    // Só valida/grava se o body de fato mandou customFieldValues — as outras
    // chamadas a esse PUT (mudar status, valor, etc.) não mandam esse campo,
    // e undefined no data do Prisma significa "não mexe", nunca "limpa".
    let cleanCustomFieldValues;
    if (customFieldValues !== undefined) {
      const fieldDefs = await prisma.customFieldDefinition.findMany({
        where: { organizationId, entityType: "DEAL" },
      });
      try {
        cleanCustomFieldValues = validateCustomFieldValues(fieldDefs, customFieldValues);
      } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 400 });
      }
    }

    const deal = await prisma.deal.update({
      where: { id },
      data: {
        name: sanitizeCell(name),
        status,
        value,
        creditType: sanitizeCell(creditType),
        description: sanitizeCell(description),
        lossReasonId,
        lostReason: sanitizeCell(lostReason),
        ownerId,
        expectedCloseAt: expectedCloseAt ? new Date(expectedCloseAt) : undefined,
        ...(closedAt ? { closedAt } : {}),
        customFieldValues: cleanCustomFieldValues,
      },
      include: { contact: true, owner: true, stage: true, lossReason: true },
    });

    // Marcos automáticos na timeline — ganho/perdido/reabertura e mudança de
    // valor, sempre que de fato mudaram (nunca em toda edição de campo).
    const systemBodies: string[] = [];
    if (status && status !== existing.status) {
      if (status === "WON") {
        const valueSuffix = deal.value != null ? ` · ${formatCurrency(Number(deal.value))}` : "";
        systemBodies.push(`marcou o negócio como ganho${valueSuffix}`);
        enqueueWebhookEvent(organizationId, "deal.won", buildDealWebhookPayload(deal)).catch((err) =>
          console.error("[webhooks] falha ao enfileirar deal.won", err),
        );
      } else if (status === "LOST") {
        const reasonSuffix = lossReasonLabel ? ` · ${lossReasonLabel}` : "";
        systemBodies.push(`marcou o negócio como perdido${reasonSuffix}`);
        enqueueWebhookEvent(organizationId, "deal.lost", buildDealWebhookPayload(deal)).catch((err) =>
          console.error("[webhooks] falha ao enfileirar deal.lost", err),
        );
      } else if (status === "OPEN") {
        systemBodies.push("reabriu o negócio");
      }
    } else if (value !== undefined) {
      const existingValueNum = existing.value != null ? Number(existing.value) : null;
      if (existingValueNum !== value) {
        systemBodies.push(`alterou o valor do negócio para ${formatCurrency(value)}`);
      }
    }
    if (systemBodies.length > 0) {
      await prisma.activity.createMany({
        data: systemBodies.map((activityBody) => ({
          organizationId,
          dealId: id,
          userId,
          type: "SYSTEM" as const,
          body: activityBody,
        })),
      });
    }

    return NextResponse.json(deal);
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(access.organizationId, async () => {
    const scope = await getDealScope(access.organizationId, access.userId, access.role);
    const existing = await prisma.deal.findFirst({
      where: { id, organizationId: access.organizationId, ...scopeWhere(scope) },
    });
    if (!existing) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    await prisma.deal.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  });
}
