/**
 * Checagem periódica de saúde das instâncias de WhatsApp — complementa (não
 * substitui) o alerta em tempo real via webhook (lib/whatsapp/events.ts).
 * Existe como rede de segurança: já tivemos um caso nesta mesma aplicação em
 * que o webhook do Evolution simplesmente não conseguia entregar eventos por
 * um problema de configuração (NEXTAUTH_URL errado) sem nenhum erro visível
 * — sem essa checagem periódica, uma desconexão silenciosa assim nunca
 * geraria alerta nenhum.
 */

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { getConnectionState } from "@/lib/evolution";
import { notifyInstanceDisconnected } from "@/lib/whatsapp/instance-alerts";

export async function checkWhatsAppInstancesHealth(): Promise<{ checked: number; disconnected: number }> {
  // Organization não tem RLS — listar todas aqui é seguro; cada organização é
  // checada depois já com o tenant certo (mesmo padrão de runAutomations e
  // cleanupExpiredChatMedia).
  const organizations = await prisma.organization.findMany({ select: { id: true } });

  let checked = 0;
  let disconnected = 0;

  for (const org of organizations) {
    await runWithTenant(org.id, async () => {
      // Só precisa checar quem a gente ACHA que está conectado — se já está
      // marcado como desconectado, não há nada de novo pra avisar.
      const instances = await prisma.whatsAppInstance.findMany({ where: { status: "CONNECTED" } });

      for (const instance of instances) {
        checked += 1;
        try {
          const state = await getConnectionState(instance.instanceName);
          if (state !== "open") {
            console.warn(
              `[wa:health] instância ${instance.instanceName} reporta "${state}" no Evolution mas estava marcada CONNECTED — corrigindo e avisando`,
            );
            await prisma.whatsAppInstance.update({ where: { id: instance.id }, data: { status: "DISCONNECTED" } });
            await notifyInstanceDisconnected(instance);
            disconnected += 1;
          }
        } catch (err) {
          console.error(`[wa:health] falha ao checar instância ${instance.instanceName}`, err);
        }
      }
    });
  }

  return { checked, disconnected };
}
