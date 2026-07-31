import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { NO_JOB_TITLE, NO_RESPONSAVEL, type EnrichedContact } from "@/lib/contacts/constants";

// Reexportados por compatibilidade com quem já importava daqui — mas
// componente "use client" deve importar de @/lib/contacts/constants
// diretamente (ver comentário lá: importar deste arquivo no cliente arrasta
// `pg` pro bundle do navegador e quebra o build).
export { NO_JOB_TITLE, NO_RESPONSAVEL, type EnrichedContact };

/** Placeholders reconstruídos na migração do Agendor (negócio órfão de
 * pessoa) — nunca aparecem na listagem de clientes, só existem pra
 * preservar o histórico do negócio (ver scripts/agendor/import-negocios.ts). */
const NO_CONTACT_TAG = "sem-contato-agendor";

export type ContactsFilterParams = {
  organizationId: string;
  q?: string;
  source?: string;
  /** Texto exato, ou NO_JOB_TITLE pra "sem cargo", ou vazio pra não filtrar. */
  jobTitle?: string;
  /** Id exato, ou NO_RESPONSAVEL pra "sem responsável", ou vazio pra não filtrar. */
  responsavelId?: string;
  /** Sigla exata (UF) — lista fechada, ver ESTADOS_BR em lib/contacts/constants.ts. */
  state?: string;
  /** Por trecho, sem diferenciar maiúsculas/acentos exatos (ver índice trigram) — cidade é texto livre, não uma lista fechada como estado. */
  city?: string;
  onlyWithDeals?: boolean;
  registeredFrom?: Date;
  registeredTo?: Date;
};

/**
 * Monta o `where` uma vez só, reaproveitado tanto pela busca da página
 * quanto pela contagem (`countContacts`) — precisam sempre bater, senão a
 * paginação mostra um total que a busca não confirma.
 */
export function buildContactsWhere(params: ContactsFilterParams): Prisma.ContactWhereInput {
  const { organizationId, q, source, jobTitle, responsavelId, state, city, onlyWithDeals, registeredFrom, registeredTo } = params;

  const where: Prisma.ContactWhereInput = {
    organizationId,
    NOT: { tags: { has: NO_CONTACT_TAG } },
    ...(source ? { source } : {}),
    ...(state ? { state } : {}),
    ...(city ? { city: { contains: city, mode: "insensitive" } } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { phone: { contains: q } },
            { whatsapp: { contains: q } },
          ],
        }
      : {}),
  };

  if (jobTitle === NO_JOB_TITLE) where.jobTitle = null;
  else if (jobTitle) where.jobTitle = jobTitle;

  if (responsavelId === NO_RESPONSAVEL) where.responsavelId = null;
  else if (responsavelId) where.responsavelId = responsavelId;

  if (onlyWithDeals) where.deals = { some: {} };

  if (registeredFrom || registeredTo) {
    where.createdAt = {
      ...(registeredFrom ? { gte: registeredFrom } : {}),
      ...(registeredTo ? { lte: registeredTo } : {}),
    };
  }

  return where;
}

export async function countContacts(params: ContactsFilterParams): Promise<number> {
  return prisma.contact.count({ where: buildContactsWhere(params) });
}

export async function fetchContactsList(params: ContactsFilterParams & { skip?: number; take: number }): Promise<EnrichedContact[]> {
  const { skip, take } = params;

  return prisma.contact.findMany({
    where: buildContactsWhere(params),
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      whatsapp: true,
      source: true,
      jobTitle: true,
      tags: true,
      responsavelId: true,
      responsavel: { select: { id: true, name: true } },
      createdAt: true,
      _count: { select: { deals: true } },
    },
    skip,
    take,
  });
}
