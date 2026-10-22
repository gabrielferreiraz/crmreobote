import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { resolveAvatarUrl } from "@/lib/r2";

export type WebhookEvent =
  | "contact.created"
  | "deal.won"
  | "deal.lost"
  | "member.created"
  | "member.activated"
  | "member.deactivated";

export const VALID_WEBHOOK_EVENTS: WebhookEvent[] = [
  "contact.created",
  "deal.won",
  "deal.lost",
  "member.created",
  "member.activated",
  "member.deactivated",
];

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
  grossValue: Prisma.Decimal | number | null;
  creditType: string | null;
  description: string | null;
  pipelineId: string;
  createdAt: Date;
  closedAt: Date | null;
  contact: { id: string; name: string; phone: string | null; email: string | null };
  owner: { id: string; name: string };
  stage: { id: string; name: string };
  lossReason?: { label: string } | null;
};

/**
 * Formato comum do payload de deal.won/deal.lost — usado tanto pela edição
 * manual (PUT /api/deals/[id]) quanto pela automação/campanha MARK_LOST.
 * Async porque busca por fora (não vem nos `include` de origem, de propósito
 * — ver cada call site) o nome da pipeline e o e-mail/foto do vendedor; quem
 * chama sempre encadeia com `.then(payload => enqueueWebhookEvent(...))
 * .catch(...)`, nunca `await` direto, pelo mesmo motivo de sempre: enfileirar
 * webhook nunca pode derrubar a ação principal que já aconteceu de verdade.
 */
export async function buildDealWebhookPayload(deal: DealForWebhook) {
  const [pipeline, ownerUser] = await Promise.all([
    prisma.pipeline.findUnique({ where: { id: deal.pipelineId }, select: { id: true, name: true } }),
    prisma.user.findUnique({ where: { id: deal.owner.id }, select: { email: true, image: true } }),
  ]);
  const ownerPhotoUrl = await resolveAvatarUrl(ownerUser?.image ?? null);

  return {
    id: deal.id,
    name: deal.name,
    status: deal.status,
    value: deal.value != null ? Number(deal.value) : null,
    grossValue: deal.grossValue != null ? Number(deal.grossValue) : null,
    creditType: deal.creditType,
    description: deal.description,
    createdAt: deal.createdAt,
    closedAt: deal.closedAt,
    pipeline: pipeline ? { id: pipeline.id, name: pipeline.name } : null,
    contact: { id: deal.contact.id, name: deal.contact.name, phone: deal.contact.phone, email: deal.contact.email },
    owner: {
      id: deal.owner.id,
      name: deal.owner.name,
      email: ownerUser?.email ?? null,
      photoUrl: ownerPhotoUrl,
    },
    stage: { id: deal.stage.id, name: deal.stage.name },
    lossReason: deal.lossReason?.label ?? null,
  };
}

type MemberForWebhook = {
  user: { id: string; name: string; email: string; image: string | null };
  role: string;
  active: boolean;
  team: { id: string; name: string } | null;
  createdAt: Date;
};

/** Mesmo formato de GET /api/v1/members (um item) — usado por member.created/activated/deactivated, pra quem já consome um ficar reconhecível no outro. */
export async function buildMemberWebhookPayload(membership: MemberForWebhook) {
  const photoUrl = await resolveAvatarUrl(membership.user.image);
  return {
    id: membership.user.id,
    name: membership.user.name,
    email: membership.user.email,
    role: membership.role,
    active: membership.active,
    team: membership.team,
    photoUrl,
    memberSince: membership.createdAt,
  };
}
