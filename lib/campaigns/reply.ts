import { prisma } from "@/lib/prisma";
import { pickOwnerId } from "@/lib/auto-assign";
import { buildDealName } from "@/lib/deal-name";
import { sendPushToUser } from "@/lib/push";

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

  sendPushToUser(ownerId, {
    title: "Novo lead respondeu",
    body: `${contact.name} respondeu · ${campaign.name}`,
    url: `/negocios/${deal.id}`,
  }).catch((err) => console.error("[campaigns] falha ao mandar push de novo lead", err));
}
