/**
 * Cria o Processo de pós-venda de um negócio ganho — chamado a partir da
 * ação manual "Adicionar ao processo" (ver app/api/processes/route.ts POST
 * e app/(dashboard)/processos/add-to-process-dialog.tsx). Ganhar o negócio
 * sozinho NÃO cria mais um processo automaticamente: o setor de
 * contemplações decide, negócio a negócio, quando (e em qual
 * Categoria/Subcategoria) ele entra no acompanhamento de pós-venda — ver
 * discussão que motivou essa mudança. Idempotente: nunca cria um segundo
 * processo pro mesmo negócio (Process.dealId é @unique).
 */

import { prisma, prismaRaw } from "@/lib/prisma";
import { setTenantOnTx } from "@/lib/tenant-context";

export async function createProcessForDeal(
  organizationId: string,
  deal: { id: string; contactId: string; ownerId: string },
  pipelineId: string,
  changedById: string,
): Promise<{ ok: true; processId: string } | { ok: false; error: string }> {
  const existing = await prisma.process.findUnique({ where: { dealId: deal.id }, select: { id: true } });
  if (existing) return { ok: false, error: "Este negócio já tem um processo" };

  const pipeline = await prisma.processPipeline.findFirst({
    where: { id: pipelineId, organizationId },
    include: { stages: { orderBy: { order: "asc" }, take: 1 } },
  });
  if (!pipeline) return { ok: false, error: "Subcategoria inválida" };
  const firstStage = pipeline.stages[0];
  if (!firstStage) return { ok: false, error: "Esta subcategoria ainda não tem nenhuma etapa configurada" };

  const process = await prisma.process.create({
    data: {
      organizationId,
      pipelineId: pipeline.id,
      stageId: firstStage.id,
      dealId: deal.id,
      contactId: deal.contactId,
      ownerId: deal.ownerId,
    },
  });

  await prisma.processStageHistory.create({
    data: {
      processId: process.id,
      organizationId,
      fromStageId: null,
      toStageId: firstStage.id,
      changedById,
    },
  });

  return { ok: true, processId: process.id };
}

/**
 * Cria o Processo direto de um CONTATO, sem negócio nenhum — para cliente que
 * já é ganho/contemplado mas cuja venda nunca virou Deal neste CRM (contrato
 * antigo, lista que o administrativo mantinha em planilha).
 *
 * Existe porque o caminho alternativo seria inventar um Deal "ganho" só para
 * destravar o processo, e negócio ganho entra em Vendas do mês, ranking da TV,
 * churrascômetro e relatórios — inflaria a venda da empresa com número que não
 * aconteceu. Aqui o processo nasce sem `dealId` (ver o model Process), e os
 * relatórios somam 0 de valor para ele, contando só na quantidade.
 *
 * `stageId` opcional: sem ele o processo entra na primeira etapa, igual ao
 * fluxo que vem do negócio. Com ele, entra direto na etapa informada — é o que
 * permite importar uma lista já distribuída pelo funil, em vez de empilhar
 * todo mundo na etapa 1 para arrastar depois.
 */
export async function createProcessForContact(
  organizationId: string,
  params:
    | { contactId: string; clientName?: never; pipelineId: string; stageId?: string; ownerId: string }
    // Sem contato nenhum: só o nome digitado, que vira Process.clientName.
    // Pedido explícito — esse acompanhamento não deve criar cliente no CRM.
    | { contactId?: never; clientName: string; pipelineId: string; stageId?: string; ownerId: string },
  changedById: string,
): Promise<{ ok: true; processId: string } | { ok: false; error: string }> {
  const { contactId, clientName, pipelineId, stageId, ownerId } = params;

  if (contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, organizationId },
      select: { id: true },
    });
    if (!contact) return { ok: false, error: "Cliente não encontrado" };
  } else if (!clientName?.trim()) {
    return { ok: false, error: "Informe o nome do cliente" };
  }

  const pipeline = await prisma.processPipeline.findFirst({
    where: { id: pipelineId, organizationId },
    include: { stages: { orderBy: { order: "asc" } } },
  });
  if (!pipeline) return { ok: false, error: "Subcategoria inválida" };
  if (pipeline.stages.length === 0) {
    return { ok: false, error: "Esta subcategoria ainda não tem nenhuma etapa configurada" };
  }

  // Etapa pedida precisa pertencer a ESTE pipeline — um id de etapa de outro
  // fluxo passaria na FK do banco e deixaria o processo numa coluna que o
  // Kanban deste pipeline nunca mostra.
  const stage = stageId ? pipeline.stages.find((s) => s.id === stageId) : pipeline.stages[0];
  if (!stage) return { ok: false, error: "Etapa não pertence a esta subcategoria" };

  const process = await prisma.process.create({
    data: {
      organizationId,
      pipelineId: pipeline.id,
      stageId: stage.id,
      // Um ou outro, nunca os dois (ver contactId/clientName no model Process).
      contactId: contactId ?? null,
      clientName: contactId ? null : clientName!.trim(),
      ownerId,
    },
  });

  await prisma.processStageHistory.create({
    data: {
      processId: process.id,
      organizationId,
      fromStageId: null,
      toStageId: stage.id,
      changedById,
    },
  });

  return { ok: true, processId: process.id };
}

/**
 * Cria CLIENTE e processo de uma vez, a partir de um nome digitado — é o que
 * o botão "Só o nome" do diálogo usa (ver add-to-process-dialog.tsx).
 *
 * Numa transação só, em vez de o navegador chamar /api/contacts e depois
 * /api/processes: com duas chamadas, uma falha no meio deixaria um cliente
 * órfão no CRM sem o processo que justificou criá-lo, e quem clicou não teria
 * como saber. Aqui ou nasce o par inteiro, ou não nasce nada.
 *
 * Reaproveita contato existente de nome idêntico (comparação exata, sem
 * diferenciar maiúsculas) em vez de criar outro: a base já tem duplicata de
 * gente real, e um botão que cria um "SENEFONTE EMP. IMOBILIARIOS LTDA" novo a
 * cada clique só pioraria isso. Nome parecido NÃO conta como igual de
 * propósito — "JOSE MAURO PINTO DE CASTRO FILHO" e "JOSE MAURO DE CAMPOS" são
 * pessoas diferentes, e casar por semelhança ligaria o processo ao cliente
 * errado.
 */
export async function createProcessWithNewContact(
  organizationId: string,
  params: { clientName: string; pipelineId: string; stageId?: string; ownerId: string },
  changedById: string,
): Promise<{ ok: true; processId: string; contactId: string; contactCreated: boolean } | { ok: false; error: string }> {
  const name = params.clientName.trim();
  if (!name) return { ok: false, error: "Informe o nome do cliente" };

  const pipeline = await prisma.processPipeline.findFirst({
    where: { id: params.pipelineId, organizationId },
    include: { stages: { orderBy: { order: "asc" } } },
  });
  if (!pipeline) return { ok: false, error: "Subcategoria inválida" };
  if (pipeline.stages.length === 0) {
    return { ok: false, error: "Esta subcategoria ainda não tem nenhuma etapa configurada" };
  }
  const stage = params.stageId ? pipeline.stages.find((s) => s.id === params.stageId) : pipeline.stages[0];
  if (!stage) return { ok: false, error: "Etapa não pertence a esta subcategoria" };

  return prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, organizationId);

    const existing = await tx.contact.findFirst({
      where: { organizationId, name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });

    const contact =
      existing ??
      (await tx.contact.create({
        // Só o nome: o resto do cadastro (telefone, origem, cargo) fica pra
        // quem for enriquecer depois. `responsavelId` fica com quem criou,
        // senão o cliente nasce sem dono e some da lista de quem o cadastrou.
        data: { organizationId, name, responsavelId: params.ownerId },
        select: { id: true },
      }));

    const process = await tx.process.create({
      data: {
        organizationId,
        pipelineId: pipeline.id,
        stageId: stage.id,
        contactId: contact.id,
        ownerId: params.ownerId,
      },
      select: { id: true },
    });

    await tx.processStageHistory.create({
      data: {
        processId: process.id,
        organizationId,
        fromStageId: null,
        toStageId: stage.id,
        changedById,
      },
    });

    return { ok: true as const, processId: process.id, contactId: contact.id, contactCreated: !existing };
  });
}
