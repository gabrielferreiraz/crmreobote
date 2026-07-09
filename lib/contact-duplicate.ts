import { prisma } from "@/lib/prisma";

export async function findDuplicateContact(
  organizationId: string,
  phoneNormalized: string | null,
  whatsappNormalized: string | null,
  excludeId?: string,
): Promise<{ message: string } | null> {
  if (!phoneNormalized && !whatsappNormalized) return null;

  const existing = await prisma.contact.findFirst({
    where: {
      organizationId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [
        ...(phoneNormalized ? [{ phoneNormalized }] : []),
        ...(whatsappNormalized ? [{ whatsappNormalized }] : []),
      ],
    },
  });

  if (!existing) return null;

  if (phoneNormalized && existing.phoneNormalized === phoneNormalized) {
    return { message: `Já existe um contato com esse telefone: ${existing.name}.` };
  }
  return { message: `Já existe um contato com esse WhatsApp: ${existing.name}.` };
}
