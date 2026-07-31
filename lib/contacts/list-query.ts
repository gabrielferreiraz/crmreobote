import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/** Sentinela pro filtro "sem cargo cadastrado" (não dá pra mandar `null` numa querystring). */
export const NO_JOB_TITLE = "__NONE__";
/** Mesma ideia pro filtro "sem responsável". */
export const NO_RESPONSAVEL = "__NONE__";

/** Placeholders reconstruídos na migração do Agendor (negócio órfão de
 * pessoa) — nunca aparecem na listagem de clientes, só existem pra
 * preservar o histórico do negócio (ver scripts/agendor/import-negocios.ts). */
const NO_CONTACT_TAG = "sem-contato-agendor";

/**
 * Só os campos que a listagem (app/(dashboard)/clientes/contacts-table.tsx)
 * de fato renderiza/filtra — endereço completo, empresa e customFieldValues
 * (JSON livre, ver lib/custom-fields.ts) só existem na página de detalhe do
 * contato (/clientes/[id], que busca o registro completo separadamente),
 * nunca na lista. Trazer isso pra até 500 linhas por página era bytes reais
 * do Postgres à toa.
 */
export type EnrichedContact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  source: string | null;
  jobTitle: string | null;
  tags: string[];
  responsavelId: string | null;
  responsavel: { id: string; name: string } | null;
  createdAt: Date;
  _count: { deals: number };
};

export type ContactsFilterParams = {
  organizationId: string;
  q?: string;
  source?: string;
  /** Texto exato, ou NO_JOB_TITLE pra "sem cargo", ou vazio pra não filtrar. */
  jobTitle?: string;
  /** Id exato, ou NO_RESPONSAVEL pra "sem responsável", ou vazio pra não filtrar. */
  responsavelId?: string;
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
  const { organizationId, q, source, jobTitle, responsavelId, onlyWithDeals, registeredFrom, registeredTo } = params;

  const where: Prisma.ContactWhereInput = {
    organizationId,
    NOT: { tags: { has: NO_CONTACT_TAG } },
    ...(source ? { source } : {}),
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
