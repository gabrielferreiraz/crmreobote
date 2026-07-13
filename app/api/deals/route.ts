import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { buildDealName } from "@/lib/deal-name";
import { pickOwnerId } from "@/lib/auto-assign";
import { sanitizeCell } from "@/lib/csv-sanitize";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const pipelineId = searchParams.get("pipelineId");
  const status = searchParams.get("status");

  const { organizationId } = await requireSession();
  if (!organizationId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const deals = await prisma.deal.findMany({
      where: {
        organizationId,
        ...(pipelineId ? { pipelineId } : {}),
        ...(status ? { status: status as "OPEN" | "WON" | "LOST" } : {}),
      },
      orderBy: { stageEnteredAt: "desc" },
      include: { contact: true, owner: true, stage: true },
    });

    return NextResponse.json(deals);
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const {
    pipelineId,
    stageId,
    contactId,
    ownerId,
    name,
    value,
    creditType,
    description,
    expectedCloseAt,
  } = body as {
    pipelineId?: string;
    stageId?: string;
    contactId?: string;
    ownerId?: string;
    name?: string;
    value?: number;
    creditType?: string;
    description?: string;
    expectedCloseAt?: string;
  };

  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId)
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  if (!pipelineId || !stageId || !contactId) {
    return NextResponse.json(
      { error: "pipelineId, stageId e contactId são obrigatórios" },
      { status: 400 },
    );
  }

  return runWithTenant(organizationId, async () => {
    const contact = await prisma.contact.findFirst({ where: { id: contactId, organizationId } });
    if (!contact) return NextResponse.json({ error: "Contato inválido" }, { status: 400 });

    const stage = await prisma.pipelineStage.findFirst({
      where: { id: stageId, pipeline: { organizationId } },
    });
    if (!stage) return NextResponse.json({ error: "Etapa inválida" }, { status: 400 });

    if (ownerId) {
      const membership = await prisma.organizationUser.findUnique({
        where: { organizationId_userId: { organizationId, userId: ownerId } },
      });
      if (!membership) return NextResponse.json({ error: "Responsável inválido" }, { status: 400 });
    }

    const resolvedOwnerId = ownerId || (await pickOwnerId(organizationId, userId));

    const deal = await prisma.deal.create({
      data: {
        organizationId,
        pipelineId,
        stageId,
        contactId,
        ownerId: resolvedOwnerId,
        name: sanitizeCell(name?.trim() || buildDealName(contact.name, contact.source)),
        value,
        creditType: sanitizeCell(creditType),
        description: sanitizeCell(description),
        expectedCloseAt: expectedCloseAt ? new Date(expectedCloseAt) : undefined,
      },
      include: { contact: true, owner: true, stage: true },
    });

    return NextResponse.json(deal, { status: 201 });
  });
}
