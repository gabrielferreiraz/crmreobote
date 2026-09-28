/**
 * Pausa e retomada AUTOMÁTICAS de campanha pela situação do WhatsApp que ela
 * usa — chamado pelo motor (lib/campaigns/engine.ts) a cada tick. As decisões
 * puras (sem banco) estão em instance-readiness.ts.
 *
 * Por que existe: o envio (sendWhatsAppMessage) recusa quem está sem WhatsApp
 * conectado ("O WhatsApp desta conversa não está conectado no CRM") e o motor
 * gravava o destinatário como FAILED — que é terminal. Uma campanha rodando
 * com o WhatsApp caído queimava um lead por tick até alguém perceber (foi
 * assim que 428 leads da "Live 28/09" viraram FAILED em 1 dia sem nenhum
 * aviso). Agora:
 *   • antes de mandar (envio inicial, reenvio e onda), o motor confere o
 *     WhatsApp que ESSE destinatário usaria; se caiu, pausa a campanha (com
 *     motivo) e NÃO consome o destinatário;
 *   • a cada tick, campanha pausada por queda cujo WhatsApp voltou a ficar
 *     CONECTADO é retomada sozinha — e só ela: pausa manual, "3 quedas em 7
 *     dias" e "5 falhas seguidas" continuam exigindo uma pessoa.
 *
 * A fonte da verdade é WhatsAppInstance.status, o MESMO campo que o envio
 * consulta (webhook do Evolution e health-check o mantêm) — pausar e retomar
 * daqui é só reagir a ele, sem depender de hookar cada lugar onde ele muda.
 *
 * Toda escrita usa condição no WHERE (só pausa quem ainda está RUNNING, só
 * retoma quem ainda está pausado por queda): uma ação manual concorrente —
 * alguém apertando Parar/Pausar/Retomar no mesmo segundo — nunca é
 * sobrescrita por este módulo.
 */

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit-log";
import { PAUSE_REASON, type PauseReason } from "@/lib/campaigns/pause-reasons";
import {
  classifyInstance,
  decideResume,
  pauseReasonForOffline,
  type InstanceHealthRow,
  type InstanceReadiness,
} from "@/lib/campaigns/instance-readiness";

const HEALTH_SELECT = {
  status: true,
  pendingDisconnectSince: true,
  recentDisconnectCount: true,
  riskWindowStartedAt: true,
} as const;

export async function getInstanceHealth(instanceId: string): Promise<InstanceHealthRow | null> {
  return prisma.whatsAppInstance.findUnique({ where: { id: instanceId }, select: HEALTH_SELECT });
}

export async function getInstanceReadiness(instanceId: string): Promise<InstanceReadiness> {
  return classifyInstance(await getInstanceHealth(instanceId));
}

// ─── auditoria ────────────────────────────────────────────────────────

const SYSTEM_ACTOR = "Sistema";

async function ownerNameOf(instanceId: string | null): Promise<string | null> {
  if (!instanceId) return null;
  const instance = await prisma.whatsAppInstance.findUnique({ where: { id: instanceId }, select: { user: { select: { name: true } } } });
  return instance?.user.name ?? null;
}

async function writeAudit(
  organizationId: string,
  campaignId: string,
  action: "CAMPAIGN_AUTO_PAUSED" | "CAMPAIGN_AUTO_RESUMED",
  describe: (campaignName: string, ownerName: string) => string,
  instanceId: string | null,
): Promise<void> {
  try {
    const [campaign, owner] = await Promise.all([
      prisma.campaign.findUnique({ where: { id: campaignId }, select: { name: true } }),
      ownerNameOf(instanceId),
    ]);
    await logAudit({
      organizationId,
      actorUserId: null,
      actorName: SYSTEM_ACTOR,
      action,
      targetType: "Campaign",
      targetId: campaignId,
      detail: describe(campaign?.name ?? campaignId, owner ?? "quem usa esta campanha"),
    });
  } catch (err) {
    // Auditar nunca pode derrubar o motor.
    console.error(`[campaigns:guard] falha ao registrar ${action} da campanha ${campaignId}`, err);
  }
}

/** Registra na auditoria uma pausa automática (a escrita da pausa em si é de quem chama). */
export async function recordAutoPause(organizationId: string, campaignId: string, reason: PauseReason, instanceId: string | null): Promise<void> {
  await writeAudit(
    organizationId,
    campaignId,
    "CAMPAIGN_AUTO_PAUSED",
    (name, owner) =>
      reason === PAUSE_REASON.WHATSAPP_DISCONNECTED
        ? `${name} — pausada automaticamente: o WhatsApp de ${owner} desconectou (volta sozinha quando reconectar)`
        : reason === PAUSE_REASON.WHATSAPP_INSTABILITY
          ? `${name} — pausada automaticamente: o WhatsApp de ${owner} caiu 3 vezes ou mais em 7 dias (retome na mão quando o número estiver estável)`
          : `${name} — pausada automaticamente após 5 falhas de envio seguidas (retome na mão depois de resolver)`,
    instanceId,
  );
}

async function recordAutoResume(organizationId: string, campaignId: string, instanceId: string): Promise<void> {
  await writeAudit(
    organizationId,
    campaignId,
    "CAMPAIGN_AUTO_RESUMED",
    (name, owner) => `${name} — retomada automaticamente: o WhatsApp de ${owner} reconectou`,
    instanceId,
  );
}

// ─── pausar / retomar ─────────────────────────────────────────────────

/**
 * Pausa a campanha porque o WhatsApp `instanceId` caiu. Só age em campanha
 * ainda RUNNING; devolve se ESTA chamada foi quem pausou.
 */
export async function pauseCampaignForOfflineInstance(
  organizationId: string,
  campaignId: string,
  instanceId: string,
  instance: InstanceHealthRow | null,
): Promise<boolean> {
  const reason = pauseReasonForOffline(instance, new Date());
  const { count } = await prisma.campaign.updateMany({
    where: { id: campaignId, status: "RUNNING" },
    data: { status: "PAUSED", pausedReason: reason, pausedInstanceId: instanceId },
  });
  if (count === 0) return false;

  console.warn(`[campaigns:guard] campanha ${campaignId} pausada automaticamente (${reason}) — WhatsApp ${instanceId} não está conectado`);
  await recordAutoPause(organizationId, campaignId, reason, instanceId);
  return true;
}

/**
 * Pausa todas as campanhas RUNNING que ainda dependem deste WhatsApp. Cobre os
 * dois desenhos:
 * - campanha de um WhatsApp só: Campaign.instanceId;
 * - envio em massa do Pipeline: CampaignRecipient.instanceId por destinatário.
 */
export async function pauseRunningCampaignsForOfflineInstance(
  organizationId: string,
  instanceId: string,
  instance: InstanceHealthRow | null = null,
): Promise<number> {
  const reason = pauseReasonForOffline(instance, new Date());
  const campaigns = await prisma.campaign.findMany({
    where: {
      organizationId,
      status: "RUNNING",
      OR: [
        { instanceId },
        { recipients: { some: { instanceId, status: { in: ["PENDING", "SENT"] } } } },
      ],
    },
    select: { id: true },
  });

  let paused = 0;
  for (const campaign of campaigns) {
    const { count } = await prisma.campaign.updateMany({
      where: { id: campaign.id, organizationId, status: "RUNNING" },
      data: { status: "PAUSED", pausedReason: reason, pausedInstanceId: instanceId },
    });
    if (count === 1) {
      paused += 1;
      await recordAutoPause(organizationId, campaign.id, reason, instanceId);
    }
  }

  if (paused > 0) {
    console.warn(`[campaigns:guard] ${paused} campanha(s) pausada(s) automaticamente (${reason}) — WhatsApp ${instanceId} não está conectado`);
  }
  return paused;
}

/**
 * Instabilidade (3+ quedas/7 dias) transforma campanhas rodando ou pausadas
 * por queda comum em pausa que exige decisão humana. Também olha
 * CampaignRecipient.instanceId para campanhas PIPELINE_BULK.
 */
export async function pauseCampaignsForUnstableInstance(organizationId: string, instanceId: string): Promise<number> {
  const pausableNow = [
    { status: "RUNNING" as const },
    { status: "PAUSED" as const, pausedReason: PAUSE_REASON.WHATSAPP_DISCONNECTED },
  ];
  const campaigns = await prisma.campaign.findMany({
    where: {
      organizationId,
      OR: [
        { instanceId },
        { pausedInstanceId: instanceId },
        { recipients: { some: { instanceId, status: { in: ["PENDING", "SENT"] } } } },
      ],
      AND: [{ OR: pausableNow }],
    },
    select: { id: true },
  });

  let paused = 0;
  for (const campaign of campaigns) {
    const { count } = await prisma.campaign.updateMany({
      where: { id: campaign.id, organizationId, OR: pausableNow },
      data: { status: "PAUSED", pausedReason: PAUSE_REASON.WHATSAPP_INSTABILITY, pausedInstanceId: instanceId },
    });
    if (count === 1) {
      paused += 1;
      await recordAutoPause(organizationId, campaign.id, PAUSE_REASON.WHATSAPP_INSTABILITY, instanceId);
    }
  }

  if (paused > 0) {
    console.warn(`[campaigns:guard] ${paused} campanha(s) pausada(s) automaticamente por instabilidade do WhatsApp ${instanceId}`);
  }
  return paused;
}

/**
 * Porteiro do envio: true = o WhatsApp está pronto, pode mandar. false = NÃO
 * mande agora — já foi tratado aqui (campanha pausada se o WhatsApp caiu; só
 * seguro o envio deste tick se o health-check está desconfiado). Quem chama
 * simplesmente pula pra próxima campanha, sem consumir destinatário nenhum.
 */
export async function ensureInstanceReadyOrPause(organizationId: string, campaignId: string, instanceId: string): Promise<boolean> {
  const instance = await getInstanceHealth(instanceId);
  const readiness = classifyInstance(instance);
  if (readiness === "ready") return true;
  if (readiness === "offline") await pauseCampaignForOfflineInstance(organizationId, campaignId, instanceId, instance);
  return false;
}

/**
 * Retoma, na organização atual, as campanhas que pausaram sozinhas por queda
 * do WhatsApp e cujo WhatsApp voltou a ficar conectado e estável. Roda a cada
 * tick ANTES de listar as campanhas RUNNING, pra elas já voltarem a enviar
 * neste mesmo tick. Devolve quantas retomou.
 */
export async function resumeCampaignsWithReconnectedInstance(organizationId: string): Promise<number> {
  const paused = await prisma.campaign.findMany({
    where: { organizationId, status: "PAUSED", pausedReason: PAUSE_REASON.WHATSAPP_DISCONNECTED },
    select: { id: true, instanceId: true, pausedInstanceId: true },
  });

  const now = new Date();
  let resumed = 0;
  for (const campaign of paused) {
    // Uma campanha com problema não pode impedir a retomada das outras.
    try {
      const instanceId = campaign.pausedInstanceId ?? campaign.instanceId;
      const decision = decideResume(await getInstanceHealth(instanceId), now);
      if (decision === "wait") continue;

      const stillPausedByDisconnect = { id: campaign.id, status: "PAUSED", pausedReason: PAUSE_REASON.WHATSAPP_DISCONNECTED } as const;

      if (decision === "needs-human") {
        // Voltou, mas o número entrou no estado de risco enquanto estava fora: vira pausa que só se desfaz na mão.
        const { count } = await prisma.campaign.updateMany({ where: stillPausedByDisconnect, data: { pausedReason: PAUSE_REASON.WHATSAPP_INSTABILITY } });
        if (count === 1) await recordAutoPause(organizationId, campaign.id, PAUSE_REASON.WHATSAPP_INSTABILITY, instanceId);
        continue;
      }

      const { count } = await prisma.campaign.updateMany({
        where: stillPausedByDisconnect,
        data: { status: "RUNNING", pausedReason: null, pausedInstanceId: null },
      });
      if (count === 1) {
        resumed += 1;
        console.log(`[campaigns:guard] campanha ${campaign.id} retomada automaticamente — o WhatsApp ${instanceId} reconectou`);
        await recordAutoResume(organizationId, campaign.id, instanceId);
      }
    } catch (err) {
      console.error(`[campaigns:guard] falha ao retomar a campanha ${campaign.id} depois da reconexão do WhatsApp`, err);
    }
  }
  return resumed;
}
