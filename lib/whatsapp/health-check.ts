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
import { getPhoneNumberHealth } from "@/lib/meta-whatsapp";
import { decryptSecret } from "@/lib/security/secret-crypto";
import { notifyInstanceDisconnected, notifyInstanceStillDisconnected } from "@/lib/whatsapp/instance-alerts";
import { isActiveMember, deleteInstanceForInactiveUser } from "@/lib/whatsapp/instance-cleanup";
import type { $Enums } from "@/app/generated/prisma/client";

const DAY_MS = 24 * 60 * 60 * 1000;
const RISK_WINDOW_MS = 7 * DAY_MS;
// Queda confirmada 3x numa janela de 7 dias é tratada como sinal de que o
// número está instável/sob suspeita da própria WhatsApp (não só uma
// coincidência de rede) — insistir mandando campanha nesse estado é
// exatamente o padrão que aumenta risco de banimento em vez de reduzir.
const RISK_THRESHOLD = 3;

type CheckableInstance = {
  id: string;
  organizationId: string;
  userId: string;
  instanceName: string;
  provider: $Enums.WhatsAppProvider;
  phoneNumber: string | null;
  pendingDisconnectSince: Date | null;
  recentDisconnectCount: number;
  riskWindowStartedAt: Date | null;
};

/** Pausa toda campanha RODANDO que dispara por essa instância — rede de segurança, não substitui o usuário retomar manualmente depois de resolver a instabilidade. */
async function pauseCampaignsForInstance(instanceId: string): Promise<void> {
  const result = await prisma.campaign.updateMany({
    where: { instanceId, status: "RUNNING" },
    data: { status: "PAUSED" },
  });
  if (result.count > 0) {
    console.warn(`[wa:health] ${result.count} campanha(s) pausada(s) automaticamente por instabilidade da instância ${instanceId}`);
  }
}

/**
 * Confirma-então-alerta compartilhado pelos dois providers — só o "como
 * checar se está saudável" muda (isHealthy). Não confirma queda na 1ª
 * checagem ruim (marca suspeita e só confirma se persistir até a próxima
 * rodada) pelo mesmo motivo nos dois casos: uma falha passageira de rede
 * não deveria virar um alerta de desconexão.
 */
async function checkAndMaybeDisconnect(
  instance: CheckableInstance,
  isHealthy: () => Promise<boolean>,
  counters: { disconnected: number },
): Promise<void> {
  try {
    const healthy = await isHealthy();

    if (healthy) {
      if (instance.pendingDisconnectSince) {
        await prisma.whatsAppInstance.update({ where: { id: instance.id }, data: { pendingDisconnectSince: null } });
      }
      return;
    }

    if (!instance.pendingDisconnectSince) {
      console.warn(
        `[wa:health] instância ${instance.instanceName} reporta problema mas estava CONNECTED — marcando suspeita, confirma na próxima rodada`,
      );
      await prisma.whatsAppInstance.update({ where: { id: instance.id }, data: { pendingDisconnectSince: new Date() } });
      return;
    }

    console.warn(`[wa:health] instância ${instance.instanceName} confirma problema numa 2ª rodada — corrigindo e avisando`);

    // Dono não é mais membro ativo: remove de vez em vez de só marcar
    // desconectado (mesma regra do webhook — ver lib/whatsapp/events.ts).
    if (!(await isActiveMember(instance.organizationId, instance.userId))) {
      await deleteInstanceForInactiveUser(instance);
      console.log(`[wa:health] instância ${instance.instanceName} removida — dono não é mais membro ativo`);
      counters.disconnected += 1;
      return;
    }

    const windowExpired =
      !instance.riskWindowStartedAt || Date.now() - instance.riskWindowStartedAt.getTime() >= RISK_WINDOW_MS;
    const nextDisconnectCount = windowExpired ? 1 : instance.recentDisconnectCount + 1;

    await prisma.whatsAppInstance.update({
      where: { id: instance.id },
      data: {
        status: "DISCONNECTED",
        disconnectedAt: new Date(),
        disconnectAlertLevel: 0,
        pendingDisconnectSince: null,
        recentDisconnectCount: nextDisconnectCount,
        riskWindowStartedAt: windowExpired ? new Date() : instance.riskWindowStartedAt,
      },
    });
    await notifyInstanceDisconnected(instance);
    counters.disconnected += 1;

    if (nextDisconnectCount >= RISK_THRESHOLD) {
      console.warn(
        `[wa:health] instância ${instance.instanceName} caiu ${nextDisconnectCount}x em 7 dias — pausando campanhas (risco de banimento)`,
      );
      await pauseCampaignsForInstance(instance.id);
    }
  } catch (err) {
    console.error(`[wa:health] falha ao checar instância ${instance.instanceName}`, err);
  }
}

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
  const counters = { disconnected: 0 };
  let escalated = 0;

  for (const org of organizations) {
    await runWithTenant(org.id, async () => {
      // Passo 1: quem achamos CONNECTED pode ter caído sem o webhook avisar —
      // "caído" significa coisas diferentes por provider (sessão Baileys vs.
      // token da Meta revogado/expirado), por isso duas checagens separadas.
      const believedConnected = await prisma.whatsAppInstance.findMany({ where: { status: "CONNECTED" } });

      for (const instance of believedConnected) {
        checked += 1;

        if (instance.provider === "META_CLOUD") {
          if (!instance.metaPhoneNumberId || !instance.metaAccessToken) {
            console.warn(`[wa:health] instância ${instance.instanceName} META_CLOUD sem credencial — pulando checagem`);
            continue;
          }
          const phoneNumberId = instance.metaPhoneNumberId;
          const accessToken = decryptSecret(instance.metaAccessToken);
          await checkAndMaybeDisconnect(
            instance,
            async () => {
              await getPhoneNumberHealth(phoneNumberId, accessToken);
              return true; // não lançou = token ainda válido
            },
            counters,
          );
          continue;
        }

        await checkAndMaybeDisconnect(
          instance,
          async () => (await getConnectionState(instance.instanceName)) === "open",
          counters,
        );
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

  return { checked, disconnected: counters.disconnected, escalated };
}
