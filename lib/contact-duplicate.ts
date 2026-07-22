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
export async function findDuplicateContact(
  organizationId: string,
  phoneNormalized: string | null,
  whatsappNormalized: string | null,
  excludeId?: string,
): Promise<{ message: string; contactId: string; responsavelId: string | null } | null> {
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
  });

  if (!existing) return null;

  if (existing.phoneNormalized && phoneVariants.includes(existing.phoneNormalized)) {
    return {
      message: `Já existe um contato com esse telefone: ${existing.name}.`,
      contactId: existing.id,
      responsavelId: existing.responsavelId,
    };
  }
  return {
    message: `Já existe um contato com esse WhatsApp: ${existing.name}.`,
    contactId: existing.id,
    responsavelId: existing.responsavelId,
  };
}
