import { prisma } from "@/lib/prisma";

export type DealScope = { type: "all" } | { type: "owners"; ownerIds: string[] };

/**
 * Donos (OWNER) sempre enxergam tudo. Consultores (MEMBER) só enxergam os
 * próprios negócios. Supervisores (ADMIN) enxergam tudo, a não ser que
 * liderem uma equipe — nesse caso ficam restritos aos negócios dos membros
 * dessa equipe (+ os próprios).
 */
export async function getDealScope(
  organizationId: string,
  userId: string,
  role: string | undefined,
): Promise<DealScope> {
  if (role === "OWNER") return { type: "all" };

  if (role === "MEMBER") return { type: "owners", ownerIds: [userId] };

  if (role !== "ADMIN") return { type: "all" };

  const team = await prisma.team.findFirst({
    where: { organizationId, leaderId: userId },
    include: { members: { select: { userId: true } } },
  });

  if (!team) return { type: "all" };

  const ownerIds = new Set(team.members.map((m) => m.userId));
  ownerIds.add(userId);

  return { type: "owners", ownerIds: Array.from(ownerIds) };
}

export function scopeWhere(scope: DealScope) {
  return scope.type === "owners" ? { ownerId: { in: scope.ownerIds } } : {};
}

/**
 * Mesma ideia de scopeWhere, mas pra qualquer model com uma relação
 * "instance" (WhatsAppThread, WhatsAppMessage) — cada vendedor tem seu
 * próprio número conectado (WhatsAppInstance.userId), então "minhas
 * conversas" é filtrado pela instância que enviou/recebeu, não por
 * Deal.ownerId (a conversa pode existir mesmo sem negócio nenhum ainda).
 */
export function whatsappScopeWhere(scope: DealScope) {
  return scope.type === "owners" ? { instance: { userId: { in: scope.ownerIds } } } : {};
}
