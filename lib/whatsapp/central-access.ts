import { prisma } from "@/lib/prisma";
import { getDealScope, type DealScope } from "@/lib/team-scope";
import { centralLeadsEnabled } from "@/lib/whatsapp/central-config";

/**
 * Atendimento ABERTO desse contato na Central, se houver. Enquanto existir,
 * o cliente só recebe pela Central (nunca por dois números): o envio pelo
 * número pessoal é barrado e o perfil abre a conversa da Central para quem
 * é o responsável.
 *
 * Com o freio de emergência acionado (CENTRAL_LEADS_ENABLED=false) não
 * bloqueia nada (ninguém conseguiria responder pela Central, o cliente
 * ficaria sem resposta) e nem consulta o banco. Sem JOIN: inboxStatus preenchido já é Central (ver schema), e o
 * índice (organizationId, contactId) resolve.
 */
export async function findOpenCentralThreadForContact(organizationId: string, contactId: string) {
  if (!centralLeadsEnabled()) return null;
  return prisma.whatsAppThread.findFirst({
    where: { organizationId, contactId, inboxStatus: "OPEN", instanceId: { not: null } },
    orderBy: { lastMessageAt: "desc" },
    select: { id: true, assigneeId: true, assignee: { select: { name: true } } },
  });
}

export type CentralAccess = {
  userId: string;
  role: string | undefined;
  scope: DealScope;
  canManageQueue: boolean;
};

export async function getCentralAccess(
  organizationId: string,
  userId: string,
  role: string | undefined,
): Promise<CentralAccess> {
  return {
    userId,
    role,
    scope: await getDealScope(organizationId, userId, role),
    canManageQueue: role === "OWNER" || role === "MANAGER" || role === "SUPERVISOR",
  };
}

export function centralAssigneeIds(access: CentralAccess): string[] | null {
  return access.scope.type === "all" ? null : access.scope.ownerIds;
}

export function canReadCentralThread(
  access: CentralAccess,
  thread: { assigneeId: string | null; inboxStatus: "OPEN" | "CLOSED" | null },
): boolean {
  if (!thread.inboxStatus) return false;
  if (thread.assigneeId === access.userId) return true;
  if (!access.canManageQueue) return false;
  if (!thread.assigneeId) return true;
  return access.scope.type === "all" || access.scope.ownerIds.includes(thread.assigneeId);
}

export function canTransferCentralThread(access: CentralAccess, targetUserId: string): boolean {
  if (!access.canManageQueue) return targetUserId === access.userId;
  return access.scope.type === "all" || access.scope.ownerIds.includes(targetUserId);
}
