import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";

export type WebhookEvent = "contact.created" | "deal.won" | "deal.lost";

export const VALID_WEBHOOK_EVENTS: WebhookEvent[] = ["contact.created", "deal.won", "deal.lost"];

/**
 * Enfileira uma entrega por assinatura ativa que escuta esse evento — nunca
 * entrega na hora (ver lib/webhooks/engine.ts, consumido pelo cron). Chamado
 * de dentro do mesmo runWithTenant de quem disparou o evento; sempre com
 * `.catch()` no call site — enfileirar webhook nunca pode derrubar a ação
 * principal (criar contato, fechar negócio) que já aconteceu de verdade.
 */
export async function enqueueWebhookEvent(
  organizationId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<void> {
  const subscriptions = await prisma.webhookSubscription.findMany({
    where: { organizationId, active: true, events: { has: event } },
    select: { id: true },
  });
  if (subscriptions.length === 0) return;

  await prisma.webhookDelivery.createMany({
    data: subscriptions.map((s) => ({
      organizationId,
      subscriptionId: s.id,
      event,
      payload: data as Prisma.InputJsonValue,
    })),
  });
}

type DealForWebhook = {
  id: string;
  name: string;
  status: string;
  value: Prisma.Decimal | number | null;
  closedAt: Date | null;
  contact: { id: string; name: string; phone: string | null; email: string | null };
  owner: { id: string; name: string };
  stage: { id: string; name: string };
  lossReason?: { label: string } | null;
};

/** Formato comum do payload de deal.won/deal.lost — usado tanto pela edição manual (PUT /api/deals/[id]) quanto pela automação MARK_LOST. */
export function buildDealWebhookPayload(deal: DealForWebhook) {
  return {
    id: deal.id,
    name: deal.name,
    status: deal.status,
    value: deal.value != null ? Number(deal.value) : null,
    closedAt: deal.closedAt,
    contact: { id: deal.contact.id, name: deal.contact.name, phone: deal.contact.phone, email: deal.contact.email },
    owner: { id: deal.owner.id, name: deal.owner.name },
    stage: { id: deal.stage.id, name: deal.stage.name },
    lossReason: deal.lossReason?.label ?? null,
  };
}
