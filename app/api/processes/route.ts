import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireProcessAccess, processScopeWhere } from "@/lib/processes/access";
import { runWithTenant } from "@/lib/tenant-context";
import type { $Enums } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

/**
 * Lista de processos — admin vê tudo, consultor só os próprios (ver
 * lib/processes/access.ts). Filtros pensados pro pós-venda (bem diferentes
 * do funil de vendas): contemplado, pagamento pendente, status de
 * documentação — todos cruzam livremente com qualquer etapa do Kanban.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const pipelineId = searchParams.get("pipelineId");
  const contemplated = searchParams.get("contemplated");
  const paymentPending = searchParams.get("paymentPending");
  const documentStatus = searchParams.get("documentStatus");

  const access = await requireProcessAccess();
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const processes = await prisma.process.findMany({
      where: {
        organizationId: access.organizationId,
        ...processScopeWhere(access),
        ...(pipelineId ? { pipelineId } : {}),
        ...(contemplated !== null ? { contemplated: contemplated === "true" } : {}),
        ...(paymentPending !== null ? { paymentPending: paymentPending === "true" } : {}),
        ...(documentStatus ? { documentStatus: documentStatus as $Enums.DocumentStatus } : {}),
      },
      orderBy: { stageEnteredAt: "desc" },
      include: {
        contact: { select: { id: true, name: true, phone: true, whatsapp: true } },
        owner: { select: { id: true, name: true } },
        stage: { select: { id: true, name: true, color: true } },
        deal: { select: { id: true, name: true, value: true } },
        _count: { select: { requests: { where: { resolvedAt: null } } } },
      },
    });

    return NextResponse.json(
      processes.map((p) => ({
        id: p.id,
        pipelineId: p.pipelineId,
        stageId: p.stageId,
        stage: p.stage,
        contemplated: p.contemplated,
        paymentPending: p.paymentPending,
        documentStatus: p.documentStatus,
        quotaNumber: p.quotaNumber,
        groupNumber: p.groupNumber,
        stageEnteredAt: p.stageEnteredAt,
        contact: p.contact,
        owner: p.owner,
        deal: { id: p.deal.id, name: p.deal.name, value: p.deal.value != null ? Number(p.deal.value) : null },
        openRequestCount: p._count.requests,
      })),
    );
  });
}
