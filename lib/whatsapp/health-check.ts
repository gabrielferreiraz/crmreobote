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
import { notifyCentralDisconnected, notifyInstanceDisconnected, notifyInstanceStillDisconnected } from "@/lib/whatsapp/instance-alerts";
import { isActiveMember, deleteInstanceForInactiveUser } from "@/lib/whatsapp/instance-cleanup";
import { RISK_THRESHOLD, RISK_WINDOW_MS } from "@/lib/whatsapp/risk";
import { pauseCampaignsForUnstableInstance, pauseRunningCampaignsForOfflineInstance } from "@/lib/campaigns/instance-guard";
import type { $Enums } from "@/app/generated/prisma/client";

const DAY_MS = 24 * 60 * 60 * 1000;
// Janela/limiar de "número instável" moram em lib/whatsapp/risk.ts (arquivo folha, sem banco — o
// motor de campanhas usa o mesmo critério pra não retomar sozinho um número suspeito). Reexportados
// aqui porque o relatório de instabilidade (app/(dashboard)/relatorios/page.tsx) e
// lib/reports/commercial-data.ts importam daqui.
export { RISK_THRESHOLD, RISK_WINDOW_MS };

type CheckableInstance = {
  id: string;
  organizationId: string;
  kind: $Enums.WhatsAppInstanceKind;
  personalOwnerId: string | null;
  instanceName: string;
  provider: $Enums.WhatsAppProvider;
  phoneNumber: string | null;
  pendingDisconnectSince: Date | null;
  recentDisconnectCount: number;
  riskWindowStartedAt: Date | null;
};

function hasPersonalOwner<T extends { personalOwnerId: string | null }>(
  instance: T,
): instance is T & { personalOwnerId: string } {
  return Boolean(instance.personalOwnerId);
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
  onConfirmedDown: () => Promise<void>,
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

    // Claim atômico: só quem pegar a instância ainda EXATAMENTE no estado
    // que a gente leu (CONNECTED, mesma pendingDisconnectSince) segue daqui
    // pra baixo — sem isso, dois ticks do cron sobrepostos (ex.: um tick
    // demorou mais que o intervalo entre execuções) podiam os dois chegar
    // nesse ponto pro mesmo registro e cada um mandar seu próprio
    // notifyInstanceDisconnected (aviso duplicado) ou tentar deletar a mesma
    // instância duas vezes.
    const claimed = await prisma.whatsAppInstance.updateMany({
      where: { id: instance.id, status: "CONNECTED", pendingDisconnectSince: instance.pendingDisconnectSince },
      data: { pendingDisconnectSince: null },
    });
    if (claimed.count === 0) {
      console.warn(
        `[wa:health] instância ${instance.instanceName} já foi tratada por outra checagem concorrente — pulando`,
      );
      return;
    }

    await onConfirmedDown();
  } catch (err) {
    console.error(`[wa:health] falha ao checar instância ${instance.instanceName}`, err);
  }
}

/** Queda confirmada de um número PESSOAL: avisa o consultor/dono, conta pro risco de banimento e pausa as campanhas dele. */
async function handlePersonalDown(
  instance: CheckableInstance & { personalOwnerId: string },
  counters: { disconnected: number },
): Promise<void> {
  // Dono não é mais membro ativo: remove de vez em vez de só marcar
  // desconectado (mesma regra do webhook — ver lib/whatsapp/events.ts).
  if (!(await isActiveMember(instance.organizationId, instance.personalOwnerId))) {
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
      recentDisconnectCount: nextDisconnectCount,
      riskWindowStartedAt: windowExpired ? new Date() : instance.riskWindowStartedAt,
    },
  });
  await notifyInstanceDisconnected(instance);
  counters.disconnected += 1;
  await pauseRunningCampaignsForOfflineInstance(instance.organizationId, instance.id, {
    status: "DISCONNECTED",
    pendingDisconnectSince: null,
    recentDisconnectCount: nextDisconnectCount,
    riskWindowStartedAt: windowExpired ? new Date() : instance.riskWindowStartedAt,
  });

  if (nextDisconnectCount >= RISK_THRESHOLD) {
    console.warn(
      `[wa:health] instância ${instance.instanceName} caiu ${nextDisconnectCount}x em 7 dias — pausando campanhas (risco de banimento)`,
    );
    await pauseCampaignsForUnstableInstance(instance.organizationId, instance.id);
  }
}

/**
 * Queda confirmada da Central de Leads. Antes a Central nem entrava nesta
 * checagem — só o webhook avisava, e foi justamente o webhook que já falhou
 * calado (ver topo do arquivo). Central fora = nenhum lead chega pra ninguém.
 */
async function handleCentralDown(instance: CheckableInstance, counters: { disconnected: number }): Promise<void> {
  await prisma.whatsAppInstance.update({
    where: { id: instance.id },
    data: { status: "DISCONNECTED", disconnectedAt: new Date(), disconnectAlertLevel: 0 },
  });
  await notifyCentralDisconnected(instance);
  counters.disconnected += 1;
}

export async function checkWhatsAppInstancesHealth(): Promise<{
  checked: number;
  disconnected: number;
  escalated: number;
}> {
  // Organization não tem RLS — listar todas aqui é seguro; cada organização é
  // checada depois já com o tenant certo (mesmo padrão de runAutomations).
  const organizations = await prisma.organization.findMany({ select: { id: true } });

  let checked = 0;
  const counters = { disconnected: 0 };
  let escalated = 0;

  for (const org of organizations) {
    await runWithTenant(org.id, async () => {
      // Passo 1: quem achamos CONNECTED pode ter caído sem o webhook avisar —
      // "caído" significa coisas diferentes por provider (sessão Baileys vs.
      // token da Meta revogado/expirado), por isso duas checagens separadas.
      const believedConnected = await prisma.whatsAppInstance.findMany({
        where: {
          status: "CONNECTED",
          OR: [{ kind: "PERSONAL", personalOwnerId: { not: null } }, { kind: "CENTRAL" }],
        },
      });

      for (const instance of believedConnected) {
        // PERSONAL sempre tem dono pelo CHECK do banco; a guarda mantém o
        // contrato explícito também para o TypeScript e para dados corrompidos.
        const personal = instance.kind === "PERSONAL" && hasPersonalOwner(instance) ? instance : null;
        if (instance.kind === "PERSONAL" && !personal) continue;
        checked += 1;
        const onConfirmedDown = personal
          ? () => handlePersonalDown(personal, counters)
          : () => handleCentralDown(instance, counters);

        if (instance.provider === "META_CLOUD") {
          if (!instance.metaPhoneNumberId || !instance.metaAccessToken) {
            console.warn(`[wa:health] instância ${instance.instanceName} META_CLOUD sem credencial — pulando checagem`);
            continue;
          }
          const phoneNumberId = instance.metaPhoneNumberId;
          const encryptedToken = instance.metaAccessToken;
          await checkAndMaybeDisconnect(
            instance,
            async () => {
              // A Meta responde token revogado/expirado com ERRO — isso é
              // "não saudável", não falha da checagem. Antes o erro subia, caía
              // no catch genérico e a queda nunca era confirmada. Falha de rede
              // passageira também cai aqui, mas só vira alerta se repetir na
              // próxima rodada (confirmação em duas etapas acima).
              try {
                await getPhoneNumberHealth(phoneNumberId, decryptSecret(encryptedToken));
                return true;
              } catch (err) {
                console.warn(`[wa:health] instância ${instance.instanceName} META_CLOUD falhou na checagem`, err);
                return false;
              }
            },
            onConfirmedDown,
          );
          continue;
        }

        await checkAndMaybeDisconnect(
          instance,
          async () => (await getConnectionState(instance.instanceName)) === "open",
          onConfirmedDown,
        );
      }

      // Passo 2: quem já está desconectado — escala o aviso conforme o tempo
      // parado, um nível de cada vez, nunca pulando nem repetindo.
      const stillDisconnected = await prisma.whatsAppInstance.findMany({
        where: {
          kind: "PERSONAL",
          personalOwnerId: { not: null },
          status: "DISCONNECTED",
          disconnectedAt: { not: null },
          disconnectAlertLevel: { lt: 3 },
        },
      });

      for (const instance of stillDisconnected) {
        if (!hasPersonalOwner(instance)) continue;
        const elapsedDays = Math.floor((Date.now() - instance.disconnectedAt!.getTime()) / DAY_MS);
        const nextLevel = Math.min(3, elapsedDays) as 0 | 1 | 2 | 3;
        if (nextLevel <= instance.disconnectAlertLevel) continue;

        // Mesmo claim atômico do passo 1: só quem pegar disconnectAlertLevel
        // ainda no valor que a gente leu manda o aviso — evita e-mail de
        // escalada duplicado se dois ticks do cron se sobrepuserem.
        const claimed = await prisma.whatsAppInstance.updateMany({
          where: { id: instance.id, disconnectAlertLevel: instance.disconnectAlertLevel },
          data: { disconnectAlertLevel: nextLevel },
        });
        if (claimed.count === 0) continue;

        await notifyInstanceStillDisconnected(instance, nextLevel as 1 | 2 | 3);
        escalated += 1;
      }
    });
  }

  return { checked, disconnected: counters.disconnected, escalated };
}
