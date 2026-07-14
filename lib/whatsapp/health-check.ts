/**
 * Checagem periódica de saúde das instâncias de WhatsApp — complementa (não
 * substitui) o alerta em tempo real via webhook (lib/whatsapp/events.ts).
 * Existe como rede de segurança: já tivemos um caso nesta mesma aplicação em
 * que o webhook do Evolution simplesmente não conseguia entregar eventos por
 * um problema de configuração (NEXTAUTH_URL errado) sem nenhum erro visível
 * — sem essa checagem periódica, uma desconexão silenciosa assim nunca
 * geraria alerta nenhum.
 *
 * Duas responsabilidades nesta função:
 * 1. Detectar quedas que o webhook não avisou (instância que achamos
 *    CONNECTED mas o Evolution já não reporta mais como "open").
 * 2. Escalar o aviso de quem já está desconectado há 1, 2 ou 3 dias (o
 *    aviso imediato da queda em si já sai na hora, via webhook ou no item 1
 *    acima — aqui só cuida do "continua desconectado há X dias").
 */

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { getConnectionState } from "@/lib/evolution";
import { notifyInstanceDisconnected, notifyInstanceStillDisconnected } from "@/lib/whatsapp/instance-alerts";
import { isActiveMember, deleteInstanceForInactiveUser } from "@/lib/whatsapp/instance-cleanup";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function checkWhatsAppInstancesHealth(): Promise<{
  checked: number;
  disconnected: number;
  escalated: number;
}> {
  // Organization não tem RLS — listar todas aqui é seguro; cada organização é
  // checada depois já com o tenant certo (mesmo padrão de runAutomations e
  // cleanupExpiredChatMedia).
  const organizations = await prisma.organization.findMany({ select: { id: true } });

  let checked = 0;
  let disconnected = 0;
  let escalated = 0;

  for (const org of organizations) {
    await runWithTenant(org.id, async () => {
      // Passo 1: quem achamos CONNECTED pode ter caído sem o webhook avisar.
      const believedConnected = await prisma.whatsAppInstance.findMany({ where: { status: "CONNECTED" } });

      for (const instance of believedConnected) {
        checked += 1;
        try {
          const state = await getConnectionState(instance.instanceName);

          if (state === "open") {
            // Saudável de verdade — limpa qualquer suspeita pendente de uma
            // rodada anterior que não se confirmou (Evolution corrigiu sozinho).
            if (instance.pendingDisconnectSince) {
              await prisma.whatsAppInstance.update({
                where: { id: instance.id },
                data: { pendingDisconnectSince: null },
              });
            }
            continue;
          }

          if (!instance.pendingDisconnectSince) {
            // 1ª vez que vemos isso — só marca a suspeita, não avisa ainda.
            // O Evolution às vezes reporta um estado errado passageiro; só
            // confirma queda de verdade se isso persistir até a próxima rodada.
            console.warn(
              `[wa:health] instância ${instance.instanceName} reporta "${state}" mas estava CONNECTED — marcando suspeita, confirma na próxima rodada`,
            );
            await prisma.whatsAppInstance.update({
              where: { id: instance.id },
              data: { pendingDisconnectSince: new Date() },
            });
            continue;
          }

          // Já vinha suspeito desde a rodada anterior e continua não-"open" —
          // agora sim é uma queda confirmada.
          console.warn(
            `[wa:health] instância ${instance.instanceName} confirma "${state}" numa 2ª rodada — corrigindo e avisando`,
          );

          // Dono não é mais membro ativo: remove de vez em vez de só marcar
          // desconectado (mesma regra do webhook — ver lib/whatsapp/events.ts).
          if (!(await isActiveMember(instance.organizationId, instance.userId))) {
            await deleteInstanceForInactiveUser(instance);
            console.log(`[wa:health] instância ${instance.instanceName} removida — dono não é mais membro ativo`);
            disconnected += 1;
            continue;
          }

          await prisma.whatsAppInstance.update({
            where: { id: instance.id },
            data: { status: "DISCONNECTED", disconnectedAt: new Date(), disconnectAlertLevel: 0, pendingDisconnectSince: null },
          });
          await notifyInstanceDisconnected(instance);
          disconnected += 1;
        } catch (err) {
          console.error(`[wa:health] falha ao checar instância ${instance.instanceName}`, err);
        }
      }

      // Passo 2: quem já está desconectado — escala o aviso conforme o tempo
      // parado, um nível de cada vez, nunca pulando nem repetindo.
      const stillDisconnected = await prisma.whatsAppInstance.findMany({
        where: { status: "DISCONNECTED", disconnectedAt: { not: null }, disconnectAlertLevel: { lt: 3 } },
      });

      for (const instance of stillDisconnected) {
        const elapsedDays = Math.floor((Date.now() - instance.disconnectedAt!.getTime()) / DAY_MS);
        const nextLevel = Math.min(3, elapsedDays) as 0 | 1 | 2 | 3;
        if (nextLevel <= instance.disconnectAlertLevel) continue;

        await notifyInstanceStillDisconnected(instance, nextLevel as 1 | 2 | 3);
        await prisma.whatsAppInstance.update({
          where: { id: instance.id },
          data: { disconnectAlertLevel: nextLevel },
        });
        escalated += 1;
      }
    });
  }

  return { checked, disconnected, escalated };
}
