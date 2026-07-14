/**
 * Limpeza de instância de WhatsApp de quem não é mais membro ativo da
 * organização — sem isso, uma instância de alguém desativado/removido fica
 * "fechada" no Evolution pra sempre, já que nada reconecta e nada mais
 * dispara um novo evento de desconexão pra pegar essa limpeza depois.
 * Nunca mexe em instância de quem continua ativo — só espera reconectar.
 */

import { prisma } from "@/lib/prisma";
import { logoutInstance, deleteInstance } from "@/lib/evolution";

export async function isActiveMember(organizationId: string, userId: string): Promise<boolean> {
  const membership = await prisma.organizationUser.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { active: true },
  });
  return membership?.active === true;
}

export async function deleteInstanceForInactiveUser(instance: { id: string; instanceName: string }): Promise<void> {
  try {
    await logoutInstance(instance.instanceName);
    await deleteInstance(instance.instanceName);
  } catch (err) {
    // Segue removendo do nosso lado mesmo se o Evolution já tiver perdido a
    // sessão ou a instância já não existir mais lá (mesmo padrão do DELETE
    // manual em app/api/whatsapp/instance/route.ts).
    console.error(`[wa:cleanup] falha ao remover instância ${instance.instanceName} do Evolution`, err);
  }
  await prisma.whatsAppInstance.delete({ where: { id: instance.id } });
}

/** Chamado quando um membro é desativado/removido — só age se já não houver conexão ativa esperando um evento futuro pra pegar essa limpeza. */
export async function cleanupInstanceIfDisconnected(organizationId: string, userId: string): Promise<void> {
  const instance = await prisma.whatsAppInstance.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
  });
  if (!instance || instance.status !== "DISCONNECTED") return;
  await deleteInstanceForInactiveUser(instance);
}
