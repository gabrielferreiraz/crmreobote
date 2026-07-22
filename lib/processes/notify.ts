/**
 * Avisos (push) do módulo de Processos — v1 deliberadamente simples (sem
 * motor de automação customizável, ver conversa que definiu o escopo):
 * avisa o time administrativo quando um processo chega numa etapa "final",
 * e quando um consultor manda uma solicitação. Nada disso bloqueia a ação
 * principal — sempre chamado com .catch() no call site.
 */

import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";

async function getProcessAdminUserIds(organizationId: string): Promise<string[]> {
  const admins = await prisma.organizationUser.findMany({
    where: { organizationId, active: true, OR: [{ role: "OWNER" }, { canManageProcesses: true }] },
    select: { userId: true },
  });
  return admins.map((a) => a.userId);
}

export async function notifyProcessReachedFinalStage(
  organizationId: string,
  process: { id: string; contactName: string; stageName: string },
): Promise<void> {
  const adminIds = await getProcessAdminUserIds(organizationId);
  await Promise.all(
    adminIds.map((userId) =>
      sendPushToUser(userId, {
        title: "Processo concluído",
        body: `${process.contactName} chegou em "${process.stageName}"`,
        url: `/processos?processId=${process.id}`,
      }).catch((err) => console.error("[processes] falha ao mandar push de etapa final", err)),
    ),
  );
}

export async function notifyProcessRequestCreated(
  organizationId: string,
  request: { id: string; processId: string; contactName: string; requesterName: string },
): Promise<void> {
  const adminIds = await getProcessAdminUserIds(organizationId);
  await Promise.all(
    adminIds.map((userId) =>
      sendPushToUser(userId, {
        title: "Solicitação de consultor",
        body: `${request.requesterName} pediu algo sobre ${request.contactName}`,
        url: `/processos?processId=${request.processId}`,
      }).catch((err) => console.error("[processes] falha ao mandar push de solicitação", err)),
    ),
  );
}
