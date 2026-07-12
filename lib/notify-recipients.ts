import { prisma } from "@/lib/prisma";

export type ResolvedRecipients = { name: string; recipients: Map<string, string> };

/**
 * E-mail de um usuário + de todo OWNER ativo da organização — reaproveitado
 * por todo alerta que precisa avisar "quem é diretamente responsável" e
 * também "quem administra a conta" (desconexão de WhatsApp, ação de
 * automação, etc.), pra não duplicar essa resolução em cada lugar.
 */
export async function resolveUserAndOrgOwners(
  organizationId: string,
  userId: string,
): Promise<ResolvedRecipients | null> {
  const [user, orgOwners] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
    prisma.organizationUser.findMany({
      where: { organizationId, role: "OWNER", active: true },
      include: { user: { select: { name: true, email: true } } },
    }),
  ]);

  if (!user) return null;

  const recipients = new Map<string, string>(); // email -> nome
  recipients.set(user.email, user.name);
  for (const ou of orgOwners) recipients.set(ou.user.email, ou.user.name);

  return { name: user.name, recipients };
}
