import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireProcessAccess } from "@/lib/processes/access";
import { runWithTenant } from "@/lib/tenant-context";
import { countProcesses, fetchProcessList } from "@/lib/processes/list-query";
import { createProcessForDeal, createProcessForContact, createProcessWithNewContact } from "@/lib/processes/create";
import { recordUserChange } from "@/lib/user-activity";
import { bodyErrorResponse, readJson } from "@/lib/read-body";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
// Teto real da paginação da tela (ver PAGE_SIZE_OPTIONS em process-list.tsx,
// que agora vai até 1000) — mesmo motivo do MAX_LIMIT em app/api/contacts.
const MAX_LIMIT = 1000;

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
  const access = await requireProcessAccess();
  if (!access.ok || !access.isAdmin) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  let body: { dealId?: string; pipelineId?: string; contactId?: string; clientName?: string; stageId?: string };
  try {
    body = await readJson(req);
  } catch (err) {
    const response = bodyErrorResponse(err);
    if (response) return response;
    throw err;
  }
  const { dealId, pipelineId, contactId, clientName, stageId } = body;

  if (!pipelineId) return NextResponse.json({ error: "pipelineId é obrigatório" }, { status: 400 });
  // Três entradas possíveis, exatamente uma por vez:
  //   dealId     — negócio já Ganho (fluxo de sempre)
  //   contactId  — cliente do CRM, mas sem negócio aqui
  //   clientName — nem cliente do CRM: só o nome, processo avulso
  const entries = [dealId, contactId, clientName].filter(Boolean).length;
  if (entries === 0) {
    return NextResponse.json({ error: "Informe dealId, contactId ou clientName" }, { status: 400 });
  }
  if (entries > 1) {
    return NextResponse.json({ error: "Informe apenas um entre dealId, contactId e clientName" }, { status: 400 });
  }

  return runWithTenant(access.organizationId, async () => {
    let result: { ok: true; processId: string } | { ok: false; error: string };

    if (clientName) {
      // Cria o CLIENTE e o processo na mesma transação (ver
      // createProcessWithNewContact) — o cliente passa a existir no CRM de
      // verdade, com responsável, e o processo já nasce ligado a ele.
      result = await createProcessWithNewContact(
        access.organizationId,
        { clientName, pipelineId, stageId, ownerId: access.userId },
        access.userId,
      );
    } else if (contactId) {
      // Responsável do processo: o do próprio cliente quando existe (é quem
      // acompanha a pessoa), senão quem está criando. Process.ownerId é
      // obrigatório e define o que o consultor enxerga (ver
      // lib/processes/access.ts), então não pode ficar sem dono.
      const contact = await prisma.contact.findFirst({
        where: { id: contactId, organizationId: access.organizationId },
        select: { responsavelId: true },
      });
      if (!contact) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 400 });

      result = await createProcessForContact(
        access.organizationId,
        { contactId, pipelineId, stageId, ownerId: contact.responsavelId ?? access.userId },
        access.userId,
      );
    } else {
      const deal = await prisma.deal.findFirst({
        where: { id: dealId, organizationId: access.organizationId, status: "WON" },
        select: { id: true, contactId: true, ownerId: true },
      });
      if (!deal) return NextResponse.json({ error: "Negócio inválido ou não está Ganho" }, { status: 400 });

      result = await createProcessForDeal(access.organizationId, deal, pipelineId, access.userId);
    }

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
