import { prisma } from "@/lib/prisma";
import { brazilianMobileVariants } from "@/lib/phone-normalize";

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
  // cuidando do lead, então ele pode ser reivindicado por quem tentou criar
  // de novo (ver claimable em POST /api/contacts). Um contato sem
  // responsável NUNCA teve dono; um com responsável desativado teve um dono
  // que saiu da empresa — mesmo efeito prático nos dois casos.
  responsavelActive: boolean;
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

  let responsavelActive = false;
  if (existing.responsavelId) {
    const membership = await prisma.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId, userId: existing.responsavelId } },
      select: { active: true },
    });
    responsavelActive = membership?.active ?? false;
  }

  const base = {
    contactId: existing.id,
    contactName: existing.name,
    createdAt: existing.createdAt,
    responsavelId: existing.responsavelId,
    responsavelName: existing.responsavel?.name ?? null,
    responsavelActive,
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
