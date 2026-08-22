import { prisma } from "@/lib/prisma";
import { pickOwnerId } from "@/lib/auto-assign";
import { buildDealName } from "@/lib/deal-name";
import { sendPushToUser } from "@/lib/push";
import { publishDealsEvent } from "@/lib/deals/live-events";

/**
 * Quando uma mensagem chega numa thread que tem um envio de campanha
 * pendente de resposta, marca a resposta e — se o contato ainda não tem
 * negócio aberto — cria um automaticamente, pra já cair pronto pra alguém
 * assumir. Chamado a partir de handleIncomingMessage (lib/whatsapp/events.ts)
 * pra toda mensagem INBOUND.
 *
 * MANUAL/PIPELINE_BULK (comportamento de sempre): cai no pipeline padrão/1ª
 * etapa, dono escolhido por rodízio (pickOwnerId) — a campanha não pertence
 * a um vendedor específico. LEAD_CAPTURE (contatos escolhidos por um
 * consultor na página de Clientes, ver lib/campaigns/lead-capture.ts): cai
 * no pipeline/etapa que o próprio consultor escolheu ao montar o disparo
 * (Campaign.targetPipelineId/targetStageId), e o dono é sempre quem criou a
 * campanha — são os leads/WhatsApp DELE, não faz sentido sortear outro dono.
 */
export async function handleCampaignReply(
  organizationId: string,
  threadId: string,
  contactId: string | null,
): Promise<void> {
  if (!contactId) return; // sem Contact vinculado não tem negócio pra criar

  const recipient = await prisma.campaignRecipient.findFirst({
    where: { threadId, status: "SENT", repliedAt: null },
  });
  if (!recipient) return;

  await prisma.campaignRecipient.update({ where: { id: recipient.id }, data: { repliedAt: new Date() } });

  const existingOpenDeal = await prisma.deal.findFirst({ where: { organizationId, contactId, status: "OPEN" } });
  if (existingOpenDeal) return;

  const [contact, campaign] = await Promise.all([
    prisma.contact.findUnique({ where: { id: contactId }, select: { name: true } }),
    prisma.campaign.findUnique({
      where: { id: recipient.campaignId },
      select: { name: true, source: true, createdById: true, targetPipelineId: true, targetStageId: true },
    }),
  ]);
  if (!contact || !campaign) return;

  let pipelineId: string;
  let stageId: string;
  if (campaign.source === "LEAD_CAPTURE" && campaign.targetPipelineId && campaign.targetStageId) {
    pipelineId = campaign.targetPipelineId;
    stageId = campaign.targetStageId;
  } else {
    const pipelines = await prisma.pipeline.findMany({
      where: { organizationId },
      orderBy: { order: "asc" },
      include: { stages: { orderBy: { order: "asc" }, take: 1 } },
    });
    const pipeline = pipelines.find((p) => p.isDefault) ?? pipelines[0];
    const firstStage = pipeline?.stages[0];
    if (!pipeline || !firstStage) return;
    pipelineId = pipeline.id;
    stageId = firstStage.id;
  }

  const ownerId =
    campaign.source === "LEAD_CAPTURE" ? campaign.createdById : await pickOwnerId(organizationId, campaign.createdById);

  const deal = await prisma.deal.create({
    data: {
      organizationId,
      pipelineId,
      stageId,
      contactId,
      ownerId,
      name: buildDealName(contact.name, `Campanha ${campaign.name}`),
    },
  });

  await prisma.campaignRecipient.update({ where: { id: recipient.id }, data: { dealId: deal.id } });

  // Quem respondeu a campanha virou negócio sozinho — avisa quem estiver
  // com o Pipeline aberto (ver lib/deals/live-events.ts).
  publishDealsEvent(organizationId, { type: "deal-created", pipelineId });

  // Marca de antemão qualquer automação "Negócio criado → Enviar notificação
  // push" como já executada pra ESTE negócio — o push logo abaixo já avisa o
  // responsável (com contexto melhor: qual campanha, quem respondeu); sem
  // isso, o próximo tick do cron de automações (lib/automations/engine.ts)
  // via esse mesmo negócio "criado" e mandava um SEGUNDO push genérico sobre
  // a mesma coisa. Só suprime a ação SEND_PUSH especificamente — se a regra
  // também criar tarefa/nota/etc., isso é outra AutomationRule (ação
  // diferente) e continua rodando normalmente.
  const dealCreatedPushRules = await prisma.automationRule.findMany({
    where: { organizationId, trigger: "DEAL_CREATED", action: "SEND_PUSH", enabled: true },
    select: { id: true },
  });
  if (dealCreatedPushRules.length > 0) {
    await prisma.automationExecution.createMany({
      data: dealCreatedPushRules.map((r) => ({
        ruleId: r.id,
        entityId: deal.id,
        success: true,
        detail: "Pulado — negócio criado por resposta de campanha, notificação já enviada separadamente.",
      })),
      skipDuplicates: true,
    });
  }

  sendPushToUser(ownerId, {
    title: "Novo lead respondeu",
    body: `${contact.name} respondeu · ${campaign.name}`,
    url: `/negocios/${deal.id}`,
  }).catch((err) => console.error("[campaigns] falha ao mandar push de novo lead", err));
}
