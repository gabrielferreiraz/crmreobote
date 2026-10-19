import { Prisma, type $Enums } from "@/app/generated/prisma/client";
import { logAudit } from "@/lib/audit-log";
import { evaluateLeadClaim } from "@/lib/lead-claim";
import { brazilianMobileVariants, resolveContactPhones } from "@/lib/phone-normalize";
import { prismaRaw } from "@/lib/prisma";
import { setTenantOnTx } from "@/lib/tenant-context";
import { enqueueWebhookEvent } from "@/lib/webhooks/enqueue";

const MAX_ROUTING_ATTEMPTS = 3;

/**
 * Erro com texto pronto pra tela (regra de negócio). Qualquer outro erro é
 * técnico: a rota loga e responde uma mensagem genérica — nunca repassa o
 * texto cru do Prisma/Postgres pro usuário.
 */
export class CentralLeadError extends Error {}

// READ COMMITTED (padrão), de propósito — NÃO Serializable: o rodízio já é
// serializado pelo SELECT ... FOR UPDATE no cursor, e a mesma conversa pelo
// FOR UPDATE na thread. Em Serializable, o FOR UPDATE sobre uma linha que
// outra transação acabou de alterar falha com erro de serialização: com dois
// leads chegando juntos (pico de campanha), o segundo falhava sempre.
const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

export type CentralRoutingResult = {
  routed: boolean;
  threadId: string;
  assigneeId: string | null;
  source: $Enums.WhatsAppAssignmentSource | null;
  contactId: string | null;
  /** Contato criado AGORA pela Central (sem cargo, needsEnrichment). */
  createdContactId: string | null;
  contactOwnershipBlocked: boolean;
  reopened: boolean;
  /** Acabou de cair na fila "Sem responsável" (não estava lá antes) — avisa a gestão uma vez só. */
  newlyQueued: boolean;
};

function notRouted(threadId: string, assigneeId: string | null, contactId: string | null): CentralRoutingResult {
  return {
    routed: false,
    threadId,
    assigneeId,
    source: null,
    contactId,
    createdContactId: null,
    contactOwnershipBlocked: false,
    reopened: false,
    newlyQueued: false,
  };
}

function isRetryableTransactionError(error: unknown): boolean {
  // P2002: dois webhooks criando o mesmo contato/evento ao mesmo tempo — na
  // nova tentativa o registro já existe e é reaproveitado. P2034: conflito/deadlock.
  return error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2034" || error.code === "P2002");
}

/**
 * Caminho rápido (o caso de quase toda mensagem): conversa já aberta com um
 * responsável ativo só precisa atribuir a mensagem a ele — 1 UPDATE, sem
 * transação longa nem travas. Devolve null quando não se aplica (sem
 * responsável, encerrada, responsável inativo) e aí roda a distribuição completa.
 */
async function attributeToCurrentAssignee(
  organizationId: string,
  threadId: string,
  messageId: string,
): Promise<{ assigneeId: string; contactId: string | null } | null> {
  const rows = await prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, organizationId);
    return tx.$queryRaw<{ assigneeId: string; contactId: string | null }[]>`
      UPDATE "WhatsAppMessage" m
         SET "attributedUserId" = t."assigneeId"
        FROM "WhatsAppThread" t
       WHERE m.id = ${messageId}
         AND t.id = ${threadId}
         AND m."threadId" = t.id
         AND t."organizationId" = ${organizationId}
         AND t."inboxStatus" = 'OPEN'
         AND t."assigneeId" IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM "OrganizationUser" ou
            WHERE ou."organizationId" = t."organizationId"
              AND ou."userId" = t."assigneeId"
              AND ou.active
         )
      RETURNING t."assigneeId" AS "assigneeId", t."contactId" AS "contactId"
    `;
  });
  return rows[0] ?? null;
}

async function routeInTransaction(
  organizationId: string,
  threadId: string,
  triggerMessageId: string,
): Promise<CentralRoutingResult> {
  return prismaRaw.$transaction(
    async (tx) => {
      await setTenantOnTx(tx, organizationId);

      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id
          FROM "WhatsAppThread"
         WHERE id = ${threadId}
           AND "organizationId" = ${organizationId}
         FOR UPDATE
      `;
      if (locked.length === 0) throw new CentralLeadError("Conversa não encontrada");

      const thread = await tx.whatsAppThread.findUnique({
        where: { id: threadId },
        select: {
          id: true,
          instanceId: true,
          contactId: true,
          assigneeId: true,
          inboxStatus: true,
          assignmentSource: true,
          routingAppliedAt: true,
          customName: true,
          whatsappName: true,
          phoneNormalized: true,
        },
      });
      if (!thread?.instanceId) return notRouted(threadId, thread?.assigneeId ?? null, thread?.contactId ?? null);

      const instance = await tx.whatsAppInstance.findFirst({
        where: { id: thread.instanceId, organizationId, kind: "CENTRAL" },
        select: { distributionPoolId: true, distributionPool: { select: { active: true } } },
      });
      if (!instance) return notRouted(threadId, thread.assigneeId, thread.contactId);
      // Sem rodízio (ou rodízio desativado) NÃO sai cedo: a conversa ainda
      // precisa reabrir (com quem já atendia, o responsável do contato ou o
      // dono do negócio) ou cair em "Sem responsável" avisando a gestão — só
      // o sorteio do rodízio fica de fora (members vazio).
      const poolId = instance.distributionPool?.active ? instance.distributionPoolId : null;

      const existingEvent = await tx.whatsAppAssignmentEvent.findUnique({
        where: { triggerMessageId },
        select: { toAssigneeId: true, source: true },
      });
      if (existingEvent) {
        await tx.whatsAppMessage.update({
          where: { id: triggerMessageId },
          data: { attributedUserId: existingEvent.toAssigneeId },
        });
        return {
          routed: true,
          threadId,
          assigneeId: existingEvent.toAssigneeId,
          source: existingEvent.source,
          contactId: thread.contactId,
          createdContactId: null,
          contactOwnershipBlocked: false,
          reopened: false,
          newlyQueued: false,
        };
      }

      let contact = thread.contactId
        ? await tx.contact.findUnique({
            where: { id: thread.contactId },
            select: { id: true, responsavelId: true },
          })
        : null;

      let createdContactId: string | null = null;
      if (!contact) {
        // getOrCreateThread já tentou vincular por variante (9º dígito), mas
        // um contato pode ter nascido entre a criação da thread e agora.
        contact = await tx.contact.findFirst({
          where: {
            organizationId,
            OR: brazilianMobileVariants(thread.phoneNormalized).flatMap((v) => [
              { whatsappNormalized: v },
              { phoneNormalized: v },
            ]),
          },
          select: { id: true, responsavelId: true },
        });
      }
      if (!contact) {
        // Fonte única de telefone (lib/phone-normalize.ts): máscara com +55 e 9º dígito.
        const phones = resolveContactPhones({ whatsapp: thread.phoneNormalized });
        const displayName = thread.customName?.trim() || thread.whatsappName?.trim() ||
          phones.whatsapp || thread.phoneNormalized;
        contact = await tx.contact.create({
          data: {
            organizationId,
            name: displayName,
            phone: phones.phone,
            phoneNormalized: phones.phoneNormalized,
            whatsapp: phones.whatsapp ?? thread.phoneNormalized,
            whatsappNormalized: phones.whatsappNormalized ?? thread.phoneNormalized,
            source: "WhatsApp Central",
            needsEnrichment: true,
          },
          select: { id: true, responsavelId: true },
        });
        createdContactId = contact.id;
      }
      if (contact.id !== thread.contactId) {
        await tx.whatsAppThread.update({ where: { id: threadId }, data: { contactId: contact.id } });
      }

      // Duas listas distintas, de propósito:
      // - activeIds: membro ativo da organização. Decide quem MANTÉM/RECEBE
      //   por vínculo (atendimento aberto, reabertura, responsável do contato,
      //   dono do negócio aberto) — pausar alguém no pool só corta lead NOVO
      //   do rodízio, nunca tira dele o que já é dele.
      // - members: pool sem pausa, na ordem do rodízio.
      const [members, activeMemberships] = await Promise.all([
        poolId
          ? tx.leadDistributionPoolMember.findMany({
              where: {
                organizationId,
                poolId,
                pausedAt: null,
                user: { orgs: { some: { organizationId, active: true } } },
              },
              orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
              select: { userId: true },
            })
          : Promise.resolve([]),
        tx.organizationUser.findMany({
          where: { organizationId, active: true },
          select: { userId: true },
        }),
      ]);
      const activeIds = new Set(activeMemberships.map((membership) => membership.userId));
      const reopened = thread.inboxStatus === "CLOSED";

      if (thread.inboxStatus === "OPEN" && thread.assigneeId && activeIds.has(thread.assigneeId)) {
        await tx.whatsAppMessage.update({
          where: { id: triggerMessageId },
          data: { attributedUserId: thread.assigneeId },
        });
        return {
          routed: true,
          threadId,
          assigneeId: thread.assigneeId,
          source: thread.assignmentSource,
          contactId: contact.id,
          createdContactId,
          contactOwnershipBlocked: contact.responsavelId !== thread.assigneeId,
          reopened: false,
          newlyQueued: false,
        };
      }

      const wasQueued = thread.inboxStatus === "OPEN" && !thread.assigneeId && thread.routingAppliedAt !== null;
      let assigneeId: string | null = null;
      let source: $Enums.WhatsAppAssignmentSource = "NO_ELIGIBLE_MEMBER";
      let roundRobinUsed = false;

      if (reopened && thread.assigneeId && activeIds.has(thread.assigneeId)) {
        assigneeId = thread.assigneeId;
        source = "REOPEN";
      } else if (contact.responsavelId && activeIds.has(contact.responsavelId)) {
        assigneeId = contact.responsavelId;
        source = "CONTACT_RESPONSIBLE";
      } else {
        const openDeals = await tx.deal.findMany({
          where: { organizationId, contactId: contact.id, status: "OPEN" },
          select: { ownerId: true },
        });
        // Inequívoco = exatamente UM dono distinto entre os negócios abertos,
        // e ele está ativo. Dois donos distintos não é inequívoco, mesmo que
        // um deles esteja inativo: vai pro rodízio.
        const openDealOwners = Array.from(new Set(openDeals.map((deal) => deal.ownerId)));

        if (openDealOwners.length === 1 && activeIds.has(openDealOwners[0])) {
          assigneeId = openDealOwners[0];
          source = "OPEN_DEAL_OWNER";
        } else if (poolId && members.length > 0) {
          await tx.leadDistributionCursor.upsert({
            where: { poolId },
            create: { organizationId, poolId, nextIndex: 0 },
            update: {},
          });
          const [cursor] = await tx.$queryRaw<{ nextIndex: number }[]>`
            SELECT "nextIndex"
              FROM "LeadDistributionCursor"
             WHERE "poolId" = ${poolId}
             FOR UPDATE
          `;
          const nextIndex = Math.max(0, cursor?.nextIndex ?? 0);
          assigneeId = members[nextIndex % members.length].userId;
          source = "ROUND_ROBIN";
          roundRobinUsed = true;
        }
      }

      if (thread.assigneeId && !activeIds.has(thread.assigneeId) && assigneeId !== thread.assigneeId) {
        source = "USER_DEACTIVATED";
      }

      let contactOwnershipBlocked = false;
      if (assigneeId && contact.responsavelId !== assigneeId) {
        const claim = await evaluateLeadClaim(organizationId, contact.id, contact.responsavelId, tx);
        if (claim.claimReason) {
          await tx.contact.update({ where: { id: contact.id }, data: { responsavelId: assigneeId } });
          contact = { ...contact, responsavelId: assigneeId };
        } else {
          contactOwnershipBlocked = true;
        }
      }

      const now = new Date();
      await tx.whatsAppThread.update({
        where: { id: threadId },
        data: {
          inboxStatus: "OPEN",
          assigneeId,
          assignedAt: assigneeId ? now : null,
          closedAt: null,
          assignmentSource: source,
          routingAppliedAt: now,
        },
      });
      await tx.whatsAppMessage.update({
        where: { id: triggerMessageId },
        data: { attributedUserId: assigneeId },
      });
      await tx.whatsAppAssignmentEvent.create({
        data: {
          organizationId,
          threadId,
          triggerMessageId,
          fromAssigneeId: thread.assigneeId,
          toAssigneeId: assigneeId,
          source,
        },
      });
      if (roundRobinUsed && poolId) {
        await tx.leadDistributionCursor.update({
          where: { poolId },
          data: { nextIndex: { increment: 1 } },
        });
      }

      return {
        routed: true,
        threadId,
        assigneeId,
        source,
        contactId: contact.id,
        createdContactId,
        contactOwnershipBlocked,
        reopened,
        newlyQueued: !assigneeId && !wasQueued,
      };
    },
    TX_OPTIONS,
  );
}

export async function routeCentralLead(
  organizationId: string,
  threadId: string,
  triggerMessageId: string,
): Promise<CentralRoutingResult> {
  const fast = await attributeToCurrentAssignee(organizationId, threadId, triggerMessageId);
  if (fast) {
    return {
      routed: true,
      threadId,
      assigneeId: fast.assigneeId,
      source: null,
      contactId: fast.contactId,
      createdContactId: null,
      contactOwnershipBlocked: false,
      reopened: false,
      newlyQueued: false,
    };
  }

  let result: CentralRoutingResult | null = null;
  for (let attempt = 1; attempt <= MAX_ROUTING_ATTEMPTS && !result; attempt += 1) {
    try {
      result = await routeInTransaction(organizationId, threadId, triggerMessageId);
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt === MAX_ROUTING_ATTEMPTS) throw error;
      // Espera curta e aleatória: duas tentativas simultâneas não colidem de novo.
      await new Promise((resolve) => setTimeout(resolve, 50 + Math.random() * 150));
    }
  }
  if (!result) throw new Error("Não foi possível distribuir a conversa");

  // Já distribuído e gravado: falha nos avisos abaixo NÃO pode virar "erro de
  // distribuição" (alertaria a gestão de um lead que já tem dono).
  if (result.createdContactId) {
    await announceCentralContact(organizationId, result.createdContactId).catch((err) =>
      console.error("[wa:central] falha ao anunciar contato criado", err),
    );
  }
  return result;
}

/**
 * Efeitos de "contato criado" FORA da transação (só depois do commit):
 * webhook contact.created e auditoria de sistema. Nunca recordUserChange —
 * isso mede trabalho de consultor, e quem criou foi a automação.
 */
async function announceCentralContact(organizationId: string, contactId: string): Promise<void> {
  const contact = await prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, organizationId);
    return tx.contact.findUnique({
      where: { id: contactId },
      select: { id: true, name: true, email: true, phone: true, whatsapp: true, source: true, tags: true, createdAt: true },
    });
  });
  if (!contact) return;
  enqueueWebhookEvent(organizationId, "contact.created", contact).catch((err) =>
    console.error("[webhooks] falha ao enfileirar contact.created (Central)", err),
  );
  await logAudit({
    organizationId,
    actorUserId: null,
    actorName: "Central de Leads",
    action: "CENTRAL_CONTACT_CREATED",
    targetType: "Contact",
    targetId: contact.id,
    detail: "Contato criado pela 1ª mensagem na Central (sem cargo)",
  });
}

export async function assignCentralLead(params: {
  organizationId: string;
  threadId: string;
  assigneeId: string;
  actorUserId: string;
  source: "MANUAL_CLAIM" | "MANUAL_TRANSFER";
}): Promise<{ assigneeId: string; contactOwnershipBlocked: boolean }> {
  return prismaRaw.$transaction(
    async (tx) => {
      await setTenantOnTx(tx, params.organizationId);
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id
          FROM "WhatsAppThread"
         WHERE id = ${params.threadId}
           AND "organizationId" = ${params.organizationId}
           AND "inboxStatus" IS NOT NULL
         FOR UPDATE
      `;
      if (locked.length === 0) throw new CentralLeadError("Conversa da Central não encontrada");

      const thread = await tx.whatsAppThread.findUnique({
        where: { id: params.threadId },
        select: {
          assigneeId: true,
          contactId: true,
          instance: { select: { kind: true } },
        },
      });
      // Não exige rodízio: sem ele todo lead cai na fila, e é justamente aí que
      // o gestor precisa assumir/transferir à mão.
      if (thread?.instance?.kind !== "CENTRAL") {
        throw new CentralLeadError("Essa conversa não está mais na Central");
      }

      // Atribuição MANUAL aceita qualquer membro ativo: a pausa do pool só
      // corta o rodízio automático; o gestor pode mandar para quem quiser.
      const activeMember = await tx.organizationUser.findFirst({
        where: { organizationId: params.organizationId, userId: params.assigneeId, active: true },
        select: { id: true },
      });
      if (!activeMember) throw new CentralLeadError("Esse atendente não está ativo");

      let contactOwnershipBlocked = false;
      if (thread.contactId) {
        const contact = await tx.contact.findUnique({
          where: { id: thread.contactId },
          select: { responsavelId: true },
        });
        if (contact && contact.responsavelId !== params.assigneeId) {
          const claim = await evaluateLeadClaim(
            params.organizationId,
            thread.contactId,
            contact.responsavelId,
            tx,
          );
          if (claim.claimReason) {
            await tx.contact.update({
              where: { id: thread.contactId },
              data: { responsavelId: params.assigneeId },
            });
          } else {
            contactOwnershipBlocked = true;
          }
        }
      }

      const now = new Date();
      await tx.whatsAppThread.update({
        where: { id: params.threadId },
        data: {
          inboxStatus: "OPEN",
          assigneeId: params.assigneeId,
          assignedAt: now,
          closedAt: null,
          assignmentSource: params.source,
          routingAppliedAt: now,
        },
      });
      await tx.whatsAppAssignmentEvent.create({
        data: {
          organizationId: params.organizationId,
          threadId: params.threadId,
          fromAssigneeId: thread.assigneeId,
          toAssigneeId: params.assigneeId,
          actorUserId: params.actorUserId,
          source: params.source,
        },
      });

      return { assigneeId: params.assigneeId, contactOwnershipBlocked };
    },
    TX_OPTIONS,
  );
}

export async function closeCentralLead(params: {
  organizationId: string;
  threadId: string;
}): Promise<void> {
  await prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, params.organizationId);
    const result = await tx.whatsAppThread.updateMany({
      where: { id: params.threadId, organizationId: params.organizationId, inboxStatus: { not: null } },
      data: { inboxStatus: "CLOSED", closedAt: new Date() },
    });
    if (result.count === 0) throw new CentralLeadError("Conversa da Central não encontrada");
  });
}
