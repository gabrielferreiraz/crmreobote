import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireProcessAccess } from "@/lib/processes/access";
import { runWithTenant } from "@/lib/tenant-context";
import { countProcesses, fetchProcessList } from "@/lib/processes/list-query";
import { createProcessForDeal } from "@/lib/processes/create";
import { recordUserChange } from "@/lib/user-activity";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Lista de processos — admin vê tudo, consultor só os próprios (ver
 * lib/processes/access.ts). Paginação de verdade (mesmo padrão de
 * /api/deals e /api/contacts, `X-Total-Count` no header) — alimenta a Lista
 * que cruza todas as Categorias/Subcategorias de uma vez.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const categoryId = searchParams.get("categoryId") ?? undefined;
  const pipelineId = searchParams.get("pipelineId") ?? undefined;
  const stageId = searchParams.get("stageId") ?? undefined;
  const documentStatus = searchParams.get("documentStatus") as
    | "NOT_REQUESTED"
    | "PENDING_DELIVERY"
    | "DELIVERED"
    | null;
  const q = searchParams.get("q") ?? undefined;
  const skipParam = Number(searchParams.get("skip"));
  const skip = Number.isFinite(skipParam) && skipParam > 0 ? skipParam : 0;
  const limitParam = Number(searchParams.get("limit"));
  const take = Math.min(Number.isFinite(limitParam) && limitParam > 0 ? limitParam : DEFAULT_LIMIT, MAX_LIMIT);

  const access = await requireProcessAccess();
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const filterParams = {
      organizationId: access.organizationId,
      ownerId: access.isAdmin ? undefined : access.userId,
      categoryId,
      pipelineId,
      stageId,
      documentStatus: documentStatus ?? undefined,
      q,
    };

    const [processes, totalCount] = await Promise.all([
      fetchProcessList({ ...filterParams, skip, take }),
      countProcesses(filterParams),
    ]);

    return NextResponse.json(processes, { headers: { "X-Total-Count": String(totalCount) } });
  });
}

/**
 * "Adicionar ao processo" — cria o Processo explicitamente pra um negócio
 * já Ganho (ver app/(dashboard)/processos/add-to-process-dialog.tsx). Só
 * admin (ver lib/processes/access.ts) — quem decide isso é o setor de
 * contemplações, não o consultor.
 */
export async function POST(req: Request) {
  const body = await req.json();
  const { dealId, pipelineId } = body as { dealId?: string; pipelineId?: string };

  const access = await requireProcessAccess();
  if (!access.ok || !access.isAdmin) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  if (!dealId || !pipelineId) {
    return NextResponse.json({ error: "dealId e pipelineId são obrigatórios" }, { status: 400 });
  }

  return runWithTenant(access.organizationId, async () => {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, organizationId: access.organizationId, status: "WON" },
      select: { id: true, contactId: true, ownerId: true },
    });
    if (!deal) return NextResponse.json({ error: "Negócio inválido ou não está Ganho" }, { status: 400 });

    const result = await createProcessForDeal(access.organizationId, deal, pipelineId, access.userId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    recordUserChange(access.organizationId, access.userId).catch((err) =>
      console.error("[user-activity] falha ao registrar alteração", err),
    );

    const process = await prisma.process.findUnique({
      where: { id: result.processId },
      include: {
        contact: { select: { id: true, name: true, phone: true, whatsapp: true } },
        owner: { select: { id: true, name: true } },
        stage: { select: { id: true, name: true, color: true } },
        pipeline: { select: { id: true, name: true, categoryId: true } },
        deal: { select: { id: true, name: true, value: true } },
      },
    });

    return NextResponse.json(process, { status: 201 });
  });
}
