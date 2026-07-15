import { prisma } from "@/lib/prisma";

export type DealScope = { type: "all" } | { type: "owners"; ownerIds: string[] };

/**
 * Donos (OWNER) sempre enxergam tudo. Gerentes (MANAGER) enxergam a união
 * das equipes que o Dono atribuiu a eles (Team.managerId — podem
 * supervisionar várias equipes/supervisores ao mesmo tempo). Supervisores
 * (SUPERVISOR) enxergam só a própria equipe (Team.leaderId). Consultores
 * (MEMBER) só enxergam os próprios negócios.
 *
 * Sem equipe atribuída/liderada, Gerente e Supervisor caem no fallback mais
 * RESTRITO (só os próprios negócios) — nunca no mais aberto. Isso é
 * deliberado: o desenho anterior (ADMIN sem equipe = vê tudo) era uma folha
 * de segurança desnecessária, já que "sem equipe" não deveria significar
 * "acesso total" por padrão.
 */
export async function getDealScope(
  organizationId: string,
  userId: string,
  role: string | undefined,
): Promise<DealScope> {
  if (role === "OWNER") return { type: "all" };

  if (role === "MANAGER") {
    const teams = await prisma.team.findMany({
      where: { organizationId, managerId: userId },
      include: { members: { select: { userId: true } } },
    });
    if (teams.length === 0) return { type: "owners", ownerIds: [userId] };
    const ownerIds = new Set(teams.flatMap((t) => t.members.map((m) => m.userId)));
    // O líder (Supervisor) de cada equipe não é necessariamente um "membro"
    // dela (Team.leaderId e OrganizationUser.teamId são independentes) —
    // sem isso, os negócios do próprio Supervisor ficavam invisíveis pro
    // Gerente que supervisiona a equipe dele.
    for (const t of teams) {
      if (t.leaderId) ownerIds.add(t.leaderId);
    }
    ownerIds.add(userId);
    return { type: "owners", ownerIds: Array.from(ownerIds) };
  }

  if (role === "SUPERVISOR") {
    const team = await prisma.team.findFirst({
      where: { organizationId, leaderId: userId },
      include: { members: { select: { userId: true } } },
    });
    if (!team) return { type: "owners", ownerIds: [userId] };
    const ownerIds = new Set(team.members.map((m) => m.userId));
    ownerIds.add(userId);
    return { type: "owners", ownerIds: Array.from(ownerIds) };
  }

  // MEMBER, ou qualquer papel desconhecido/futuro — nunca abre acesso total.
  return { type: "owners", ownerIds: [userId] };
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
