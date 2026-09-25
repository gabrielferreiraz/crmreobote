import { prisma } from "@/lib/prisma";
import { brazilianMobileVariants } from "@/lib/phone-normalize";
import { evaluateLeadClaim, type LeadClaimReason } from "@/lib/lead-claim";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Freio contra usar o cadastro de contato como ORÁCULO de "esse telefone já está na
 * base, e de quem é?" — o 409 de duplicidade devolve o nome do contato existente e do
 * responsável (é o que permite "Solicitar/Assumir lead", recurso de propósito), então
 * quem cadastra número atrás de número consegue mapear a carteira dos outros
 * (achado do relatório de QA). Não remove o recurso; limita a frequência: 40
 * duplicidades por hora por usuário é bem mais do que qualquer uso real, e bem menos
 * do que uma varredura. Em memória por processo (mesma limitação de lib/rate-limit.ts).
 */
const CONFLICT_LOOKUPS_PER_HOUR = 40;

export const CONFLICT_THROTTLED_MESSAGE =
  "Muitas tentativas de cadastrar contatos que já existem. Aguarde um pouco antes de tentar de novo.";

/** true = este usuário já estourou o limite de duplicidades na última hora (a rota responde 429 em vez do 409 com dados do dono). */
export function isConflictLookupThrottled(userId: string): boolean {
  return !rateLimit(`contact-conflict:${userId}`, CONFLICT_LOOKUPS_PER_HOUR, 60 * 60 * 1000).allowed;
}

/**
 * Busca por VARIANTE (com/sem o 9º dígito do celular), não pela chave
 * exata — mesmo problema documentado em lib/phone-normalize.ts's
 * brazilianMobileVariants e já corrigido pra conversas de WhatsApp (ver
 * lib/whatsapp/threads.ts's resolveContactForNumber). Sem isso, um
 * integrador externo (Meta Lead Ads, N8N, importação de CSV, cadastro
 * manual) mandando o mesmo número num formato de dígitos diferente do já
 * salvo criava um SEGUNDO contato duplicado em vez de reconhecer a pessoa —
 * o dedupe existia, mas só pegava o caso "número idêntico byte a byte".
 */
export type DuplicateContact = {
  message: string;
  contactId: string;
  contactName: string;
  createdAt: Date;
  responsavelId: string | null;
  responsavelName: string | null;
  // false tanto pra "sem responsável" quanto pra "responsável desativado"
  // (OrganizationUser.active) — nos dois casos ninguém ativo está de fato
  // cuidando do lead. Continua existindo por compatibilidade (ex.:
  // lib/api/upsert-contact.ts), mas quem decide se o lead pode ser assumido
  // é `claimReason` abaixo — ele também cobre "perdido há +3 meses", que
  // este booleano não enxerga (o dono ainda está ativo nesse caso).
  responsavelActive: boolean;
  // Não-nulo = quem tentou cadastrar de novo pode ASSUMIR o lead na hora,
  // sem aprovação (ver lib/lead-claim.ts, a regra única). Nulo = dono ativo
  // cuidando do lead → só dá pra solicitar.
  claimReason: LeadClaimReason | null;
  /** Só quando claimReason é LOST_OVER_3_MONTHS: quando o lead foi perdido pela última vez. */
  lostAt: Date | null;
  phone: string | null;
  phoneNormalized: string | null;
  whatsapp: string | null;
  whatsappNormalized: string | null;
};

export async function findDuplicateContact(
  organizationId: string,
  phoneNormalized: string | null,
  whatsappNormalized: string | null,
  excludeId?: string,
): Promise<DuplicateContact | null> {
  if (!phoneNormalized && !whatsappNormalized) return null;

  const phoneVariants = phoneNormalized ? brazilianMobileVariants(phoneNormalized) : [];
  const whatsappVariants = whatsappNormalized ? brazilianMobileVariants(whatsappNormalized) : [];

  const existing = await prisma.contact.findFirst({
    where: {
      organizationId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [
        ...(phoneVariants.length ? [{ phoneNormalized: { in: phoneVariants } }] : []),
        ...(whatsappVariants.length ? [{ whatsappNormalized: { in: whatsappVariants } }] : []),
      ],
    },
    include: { responsavel: { select: { name: true } } },
  });

  if (!existing) return null;

  const claim = await evaluateLeadClaim(organizationId, existing.id, existing.responsavelId);

  const base = {
    contactId: existing.id,
    contactName: existing.name,
    createdAt: existing.createdAt,
    responsavelId: existing.responsavelId,
    responsavelName: existing.responsavel?.name ?? null,
    responsavelActive: claim.ownerActive,
    claimReason: claim.claimReason,
    lostAt: claim.lostAt,
    phone: existing.phone,
    phoneNormalized: existing.phoneNormalized,
    whatsapp: existing.whatsapp,
    whatsappNormalized: existing.whatsappNormalized,
  };

  if (existing.phoneNormalized && phoneVariants.includes(existing.phoneNormalized)) {
    return { ...base, message: `Já existe um contato com esse telefone: ${existing.name}.` };
  }
  return { ...base, message: `Já existe um contato com esse WhatsApp: ${existing.name}.` };
}

/**
 * O que a tela recebe no corpo do 409 (POST e PUT de /api/contacts) —
 * serializado num lugar só pra os dois nunca divergirem. `viewerUserId` é
 * quem está tentando: um lead que já é DELE nunca é assumível nem
 * solicitável (não faz sentido pedir/assumir o próprio lead).
 *
 * - claimable: pode assumir agora, sem aprovação (claimReason diz por quê).
 * - requestable: dono ATIVO cuidando do lead → só dá pra solicitar (o dono
 *   aprova/recusa, ver PATCH /api/lead-requests/[id]).
 * - nenhum dos dois (ownedByMe): só informa.
 */
export type ContactConflictPayload = {
  contactId: string;
  contactName: string;
  createdAt: Date;
  responsavelName: string | null;
  claimable: boolean;
  claimReason: LeadClaimReason | null;
  lostAt: Date | null;
  requestable: boolean;
  ownedByMe: boolean;
};

export function buildConflictPayload(duplicate: DuplicateContact, viewerUserId: string | null): ContactConflictPayload {
  const ownedByMe = !!viewerUserId && duplicate.responsavelId === viewerUserId;
  return {
    contactId: duplicate.contactId,
    contactName: duplicate.contactName,
    createdAt: duplicate.createdAt,
    responsavelName: duplicate.responsavelName,
    claimable: !ownedByMe && duplicate.claimReason !== null,
    claimReason: ownedByMe ? null : duplicate.claimReason,
    lostAt: ownedByMe ? null : duplicate.lostAt,
    requestable: !ownedByMe && duplicate.claimReason === null,
    ownedByMe,
  };
}
