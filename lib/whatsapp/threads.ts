/**
 * Resolução/gestão de conversas de WhatsApp (WhatsAppThread) — a conversa
 * existe por si só, o vínculo com um Contact do CRM é opcional (ver
 * prisma/schema.prisma). Centralizado aqui porque tanto o webhook (mensagem
 * recebida de qualquer número) quanto o envio manual/automação (mensagem
 * enviada a partir de um Contact já conhecido) precisam da mesma lógica de
 * achar-ou-criar a conversa certa.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { brazilianMobileVariants, normalizePhoneNumber } from "@/lib/phone-normalize";

/** Acha um Contact do CRM cujo telefone bata com o número normalizado (considera a variante com/sem o 9º dígito). */
export async function resolveContactForNumber(
  organizationId: string,
  phoneNormalized: string,
): Promise<{ id: string } | null> {
  const variants = brazilianMobileVariants(phoneNormalized);
  return prisma.contact.findFirst({
    where: {
      organizationId,
      OR: variants.flatMap((v) => [{ whatsappNormalized: v }, { phoneNormalized: v }]),
    },
    select: { id: true },
  });
}

type GetOrCreateThreadParams = {
  organizationId: string;
  instanceId: string;
  phoneNormalized: string;
  whatsappName?: string | null;
};

/**
 * Acha (ou cria) a conversa dessa instância com esse número. A cada
 * chamada, se a conversa ainda não tem Contact vinculado, tenta achar um —
 * promove a conversa pra aba "WhatsApp CRM" automaticamente assim que um
 * Contact com esse número passar a existir, mesmo que a conversa já
 * existisse antes sem vínculo nenhum.
 */
export async function getOrCreateThread(params: GetOrCreateThreadParams) {
  const { organizationId, instanceId, phoneNormalized, whatsappName } = params;

  const existing = await prisma.whatsAppThread.findUnique({
    where: { instanceId_phoneNormalized: { instanceId, phoneNormalized } },
  });

  if (existing) {
    const data: { contactId?: string; whatsappName?: string } = {};
    if (!existing.contactId) {
      const contact = await resolveContactForNumber(organizationId, phoneNormalized);
      if (contact) data.contactId = contact.id;
    }
    if (whatsappName && whatsappName !== existing.whatsappName) data.whatsappName = whatsappName;
    if (Object.keys(data).length === 0) return existing;
    return prisma.whatsAppThread.update({ where: { id: existing.id }, data });
  }

  const contact = await resolveContactForNumber(organizationId, phoneNormalized);
  try {
    return await prisma.whatsAppThread.create({
      data: {
        organizationId,
        instanceId,
        phoneNormalized,
        whatsappName: whatsappName ?? undefined,
        contactId: contact?.id,
      },
    });
  } catch (err) {
    // Corrida: duas mensagens do mesmo número chegaram quase juntas e ambas
    // tentaram criar a conversa — a que perdeu só busca a que já existe.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return prisma.whatsAppThread.findUniqueOrThrow({
        where: { instanceId_phoneNormalized: { instanceId, phoneNormalized } },
      });
    }
    throw err;
  }
}

/**
 * Depois que um Contact é criado (manual ou importado), re-checa toda
 * conversa avulsa desta organização (thread sem Contact vinculado) contra a
 * tabela de Contact — promove na hora pra aba "WhatsApp CRM" quem bater, em
 * vez de esperar a próxima mensagem chegar pra fazer essa ligação.
 *
 * Só para uso em lote de verdade (importação em massa, ver
 * app/api/contacts/import/route.ts) — é O(órfãos), varre e resolve uma a
 * uma. Pra criar/upsertar UM contato por vez (cadastro manual, API externa),
 * use `linkOrphanThreadsForContact`, que é O(1) indexado em vez de
 * rescanear a organização inteira a cada chamada.
 */
export async function linkOrphanThreadsForOrganization(organizationId: string): Promise<number> {
  const orphans = await prisma.whatsAppThread.findMany({
    where: { organizationId, contactId: null },
    select: { id: true, phoneNormalized: true },
  });
  if (orphans.length === 0) return 0;

  let linked = 0;
  for (const orphan of orphans) {
    const contact = await resolveContactForNumber(organizationId, orphan.phoneNormalized);
    if (contact) {
      await prisma.whatsAppThread.update({ where: { id: orphan.id }, data: { contactId: contact.id } });
      linked += 1;
    }
  }
  return linked;
}

/**
 * Mesma promoção de `linkOrphanThreadsForOrganization`, mas dirigida a UM
 * contato recém-criado/atualizado: busca direto (indexado por
 * phoneNormalized, que já é @unique) as threads órfãs que batem com os
 * números dele, em vez de rescanear toda a organização. Chamada em todo
 * cadastro manual e em todo upsert da API externa (/api/v1/contacts) — um
 * rescan completo nesses pontos degradava com o volume de conversas avulsas
 * acumuladas, principalmente na integração externa, pensada pra alto volume.
 */
export async function linkOrphanThreadsForContact(
  organizationId: string,
  contactId: string,
  normalizedNumbers: Array<string | null | undefined>,
): Promise<number> {
  const variants = new Set(
    normalizedNumbers
      .filter((n): n is string => !!n)
      .flatMap((n) => brazilianMobileVariants(n)),
  );
  if (variants.size === 0) return 0;

  const { count } = await prisma.whatsAppThread.updateMany({
    where: { organizationId, contactId: null, phoneNormalized: { in: Array.from(variants) } },
    data: { contactId },
  });
  return count;
}

type GetOrCreateThreadForContactParams = {
  organizationId: string;
  instance: { id: string };
  contact: { id: string; whatsapp: string | null; phone: string | null };
};

/**
 * Atalho pro fluxo iniciado pelo CRM (página do negócio, automação): quando
 * já se sabe o Contact de antemão, resolve o número dele (WhatsApp é o
 * principal; celular só entra se não houver WhatsApp) e acha/cria a
 * conversa já vinculada a esse Contact.
 */
export async function getOrCreateThreadForContact(params: GetOrCreateThreadForContactParams) {
  const { organizationId, instance, contact } = params;
  const phoneNormalized = normalizePhoneNumber(contact.whatsapp || contact.phone);
  if (!phoneNormalized) return null;

  const existing = await prisma.whatsAppThread.findUnique({
    where: { instanceId_phoneNormalized: { instanceId: instance.id, phoneNormalized } },
  });
  if (existing) {
    if (existing.contactId === contact.id) return existing;
    return prisma.whatsAppThread.update({ where: { id: existing.id }, data: { contactId: contact.id } });
  }

  try {
    return await prisma.whatsAppThread.create({
      data: { organizationId, instanceId: instance.id, phoneNormalized, contactId: contact.id },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const raced = await prisma.whatsAppThread.findUniqueOrThrow({
        where: { instanceId_phoneNormalized: { instanceId: instance.id, phoneNormalized } },
      });
      if (raced.contactId !== contact.id) {
        return prisma.whatsAppThread.update({ where: { id: raced.id }, data: { contactId: contact.id } });
      }
      return raced;
    }
    throw err;
  }
}
