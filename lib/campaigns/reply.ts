import { prisma } from "@/lib/prisma";
import { pickOwnerId } from "@/lib/auto-assign";
import { buildDealName } from "@/lib/deal-name";

/**
 * Quando uma mensagem chega numa thread que tem um envio de campanha
 * pendente de resposta, marca a resposta e — se o contato ainda não tem
 * negócio aberto — cria um automaticamente (funil padrão, responsável por
 * rodízio), pra já cair pronto pra alguém assumir. Chamado a partir de
 * handleIncomingMessage (lib/whatsapp/events.ts) pra toda mensagem INBOUND.
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

  const [pipelines, contact, campaign] = await Promise.all([
    prisma.pipeline.findMany({
      where: { organizationId },
      orderBy: { order: "asc" },
      include: { stages: { orderBy: { order: "asc" }, take: 1 } },
    }),
    prisma.contact.findUnique({ where: { id: contactId }, select: { name: true } }),
    prisma.campaign.findUnique({ where: { id: recipient.campaignId }, select: { name: true, createdById: true } }),
  ]);
  const pipeline = pipelines.find((p) => p.isDefault) ?? pipelines[0];
  const firstStage = pipeline?.stages[0];
  if (!pipeline || !firstStage || !contact || !campaign) return;

  const ownerId = await pickOwnerId(organizationId, campaign.createdById);

  await prisma.deal.create({
    data: {
      organizationId,
      pipelineId: pipeline.id,
      stageId: firstStage.id,
      contactId,
      ownerId,
      name: buildDealName(contact.name, `Campanha ${campaign.name}`),
    },
  });
}
