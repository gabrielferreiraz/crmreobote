/**
 * Destinatários configuráveis das ações "Enviar WhatsApp"/"Enviar e-mail" das
 * automações — antes cada ação tinha um único destino fixo (WhatsApp sempre
 * pro contato; e-mail sempre pro responsável + donos). Agora quem cria a
 * regra escolhe uma lista: cliente, o próprio responsável, o supervisor
 * (líder da equipe dele), uma pessoa específica (admin/dono) ou um
 * número/e-mail avulso digitado na hora.
 */

import { prisma } from "@/lib/prisma";
import { normalizePhoneNumber } from "@/lib/phone-normalize";

export type RecipientEntry =
  | { type: "CLIENT" }
  | { type: "RESPONSIBLE" }
  | { type: "SUPERVISOR" }
  | { type: "ADMIN"; userId: string }
  | { type: "OWNER"; userId: string }
  | { type: "CUSTOM"; value: string };

type EntityRef = { organizationId: string; ownerId: string; contactId?: string };

/** Líder da equipe de quem é dono da entidade — null se ele não tiver equipe/líder, ou se ele mesmo for o líder (não faz sentido "supervisionar" a si mesmo). */
async function resolveSupervisorUserId(organizationId: string, ownerId: string): Promise<string | null> {
  const membership = await prisma.organizationUser.findUnique({
    where: { organizationId_userId: { organizationId, userId: ownerId } },
    select: { teamId: true },
  });
  if (!membership?.teamId) return null;

  const team = await prisma.team.findUnique({ where: { id: membership.teamId }, select: { leaderId: true } });
  if (!team?.leaderId || team.leaderId === ownerId) return null;
  return team.leaderId;
}

async function resolveUserId(entity: EntityRef, entry: RecipientEntry): Promise<string | null> {
  if (entry.type === "RESPONSIBLE") return entity.ownerId;
  if (entry.type === "SUPERVISOR") return resolveSupervisorUserId(entity.organizationId, entity.ownerId);
  if (entry.type === "ADMIN" || entry.type === "OWNER") return entry.userId;
  return null;
}

/** E-mails resolvidos a partir da lista configurada — usado pela ação "Enviar e-mail". */
export async function resolveEmailAddresses(
  entity: EntityRef,
  recipients: RecipientEntry[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>(); // email -> nome

  for (const entry of recipients) {
    if (entry.type === "CUSTOM") {
      if (entry.value.includes("@")) result.set(entry.value, entry.value);
      continue;
    }
    if (entry.type === "CLIENT") {
      if (!entity.contactId) continue;
      const contact = await prisma.contact.findUnique({
        where: { id: entity.contactId },
        select: { name: true, email: true },
      });
      if (contact?.email) result.set(contact.email, contact.name);
      continue;
    }
    const userId = await resolveUserId(entity, entry);
    if (!userId) continue;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
    if (user) result.set(user.email, user.name);
  }

  return result;
}

export type WhatsappRecipient = { phoneNormalized: string };

/** Números resolvidos a partir da lista configurada — usado pela ação "Enviar WhatsApp". */
export async function resolveWhatsappRecipients(
  entity: EntityRef,
  recipients: RecipientEntry[],
): Promise<WhatsappRecipient[]> {
  const result: WhatsappRecipient[] = [];

  for (const entry of recipients) {
    if (entry.type === "CUSTOM") {
      const normalized = normalizePhoneNumber(entry.value);
      if (normalized) result.push({ phoneNormalized: normalized });
      continue;
    }
    if (entry.type === "CLIENT") {
      if (!entity.contactId) continue;
      const contact = await prisma.contact.findUnique({
        where: { id: entity.contactId },
        select: { whatsapp: true, phone: true },
      });
      const normalized = normalizePhoneNumber(contact?.whatsapp || contact?.phone);
      if (normalized) result.push({ phoneNormalized: normalized });
      continue;
    }
    const userId = await resolveUserId(entity, entry);
    if (!userId) continue;
    // O único "número pessoal" que o sistema conhece de um usuário é o
    // telefone da própria instância de WhatsApp dele — se não tiver
    // conectado, não tem como mandar mensagem pra ele por aqui. Pode ter até
    // duas linhas agora (uma por provider); prefere a conectada, entre as
    // duas conectadas prefere a Meta (mesmo critério de resolveConnectedInstance).
    const instances = await prisma.whatsAppInstance.findMany({
      where: { organizationId: entity.organizationId, userId },
      select: { provider: true, status: true, phoneNumber: true },
    });
    const instance =
      instances.find((i) => i.provider === "META_CLOUD" && i.status === "CONNECTED") ??
      instances.find((i) => i.provider === "EVOLUTION" && i.status === "CONNECTED");
    const normalized = normalizePhoneNumber(instance?.phoneNumber);
    if (normalized) result.push({ phoneNormalized: normalized });
  }

  return result;
}
