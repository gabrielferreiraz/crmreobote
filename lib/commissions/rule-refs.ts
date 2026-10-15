import { prisma } from "@/lib/prisma";
import type { RuleInput } from "@/lib/commissions/validation";

/** Pessoa e administradora citadas na regra precisam ser DESTA organização. */
export async function checkRuleReferences(organizationId: string, data: RuleInput): Promise<string | null> {
  if (data.userId) {
    const member = await prisma.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId, userId: data.userId } },
      select: { userId: true },
    });
    if (!member) return "Pessoa inválida";
  }
  if (data.administratorId) {
    const administrator = await prisma.consortiumAdministrator.findFirst({
      where: { id: data.administratorId, organizationId },
      select: { id: true },
    });
    if (!administrator) return "Administradora inválida";
  }
  return null;
}
