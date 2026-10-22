import { randomUUID } from "crypto";
import { after, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit-log";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { createInstance, deleteInstance, EvolutionApiError, getConnectionState, getQrCode, logoutInstance } from "@/lib/evolution";
import { buildEvolutionProxyPayload, validateProxyInput, type ProxyInput } from "@/lib/whatsapp/proxy";
import { provisionEvolutionConnection } from "@/lib/whatsapp/provision-evolution";
import { saveCentralDistributionPool } from "@/lib/whatsapp/central-settings";
import { CentralLeadError } from "@/lib/whatsapp/lead-routing";
import { forgetCentralVisibility } from "@/lib/whatsapp/central-visibility";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const globalForCentralProvisioning = globalThis as unknown as {
  centralProvisioningTasks?: Map<string, Promise<void>>;
};
const provisioningTasks = globalForCentralProvisioning.centralProvisioningTasks ?? new Map<string, Promise<void>>();
globalForCentralProvisioning.centralProvisioningTasks = provisioningTasks;

function webhookUrl(): string {
  const appUrl = process.env.NEXTAUTH_URL;
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET;
  if (!appUrl || !secret) throw new Error("Webhook do WhatsApp não configurado");
  return `${appUrl.replace(/\/$/, "")}/api/whatsapp/webhook?secret=${encodeURIComponent(secret)}`;
}

function provisionCentral(organizationId: string, instance: Awaited<ReturnType<typeof loadCentralInstance>>, created: boolean) {
  if (!instance) return;
  if (provisioningTasks.has(instance.instanceName)) return;

  const task = runWithTenant(organizationId, async () => {
    const result = await provisionEvolutionConnection(created, {
      create: () => createInstance(instance.instanceName, webhookUrl(), buildEvolutionProxyPayload(instance)),
      getState: () => getConnectionState(instance.instanceName, 5_000),
      getQrCode: () => getQrCode(instance.instanceName, 10_000),
      isMissingInstance: (error) => error instanceof EvolutionApiError && error.status === 404,
      delay: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    });
    await prisma.whatsAppInstance.update({ where: { id: instance.id }, data: { status: result.status } });
    if (result.error) console.error("[wa:central] falha ao preparar instância", result.error);
  })
    // Roda depois da resposta (after): erro aqui não tem quem trate — só loga,
    // e a tela para de esperar o QR sozinha (ver central-settings-dialog).
    .catch((err) => console.error("[wa:central] falha inesperada no provisionamento", err))
    .finally(() => provisioningTasks.delete(instance.instanceName));
  provisioningTasks.set(instance.instanceName, task);
}

async function loadCentralInstance(organizationId: string) {
  return prisma.whatsAppInstance.findFirst({
    where: { organizationId, kind: "CENTRAL", provider: "EVOLUTION" },
  });
}

export async function POST(request: Request) {
  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as {
    name?: string;
    memberUserIds?: unknown;
    pausedUserIds?: unknown;
    memberPercentages?: unknown;
    proxy?: ProxyInput;
  };
  let memberUserIds: string[] | undefined;
  if (body.memberUserIds !== undefined) {
    if (!Array.isArray(body.memberUserIds) || body.memberUserIds.some((id) => typeof id !== "string")) {
      return NextResponse.json({ error: "Escolha atendentes válidos" }, { status: 400 });
    }
    memberUserIds = body.memberUserIds as string[];
  }
  let distributionPercentages: { userId: string; percent: number }[] | undefined;
  if (body.memberPercentages !== undefined) {
    if (
      !Array.isArray(body.memberPercentages) ||
      body.memberPercentages.some(
        (item) =>
          !item ||
          typeof item !== "object" ||
          typeof (item as { userId?: unknown }).userId !== "string" ||
          typeof (item as { percent?: unknown }).percent !== "number",
      )
    ) {
      return NextResponse.json({ error: "Defina a porcentagem de todos os atendentes" }, { status: 400 });
    }
    distributionPercentages = body.memberPercentages as { userId: string; percent: number }[];
  }
  const pausedUserIds = Array.isArray(body.pausedUserIds)
    ? body.pausedUserIds.filter((id): id is string => typeof id === "string")
    : [];
  const proxy = validateProxyInput(body.proxy);
  if (!proxy.ok) return NextResponse.json({ error: proxy.error }, { status: 400 });
  // Sem URL/segredo do webhook o número conectaria mas nenhuma mensagem chegaria ao CRM.
  try {
    webhookUrl();
  } catch {
    return NextResponse.json({ error: "Webhook do WhatsApp não configurado no servidor" }, { status: 500 });
  }

  return runWithTenant(access.organizationId, async () => {
    // Reconectar reaproveita o pool existente (com as pausas como estão);
    // a lista de atendentes só é obrigatória na primeira conexão.
    const existingPool = await prisma.leadDistributionPool.findFirst({
      where: { organizationId: access.organizationId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    let poolId = existingPool?.id ?? null;
    if (memberUserIds && memberUserIds.length > 0 && !poolId) {
      try {
        poolId = await saveCentralDistributionPool({
          organizationId: access.organizationId,
          name: body.name ?? "Central de Leads",
          memberUserIds,
          pausedUserIds,
          distributionPercentages,
        });
      } catch (error) {
        if (error instanceof CentralLeadError) return NextResponse.json({ error: error.message }, { status: 400 });
        console.error("[wa:central] falha ao salvar atendentes", error);
        return NextResponse.json({ error: "Não foi possível salvar os atendentes." }, { status: 500 });
      }
    }
    if (!poolId) return NextResponse.json({ error: "Escolha ao menos um atendente" }, { status: 400 });
    let instance = await loadCentralInstance(access.organizationId);
    let created = false;
    if (!instance) {
      try {
        instance = await prisma.whatsAppInstance.create({
          data: {
            organizationId: access.organizationId,
            kind: "CENTRAL",
            connectedById: access.userId,
            distributionPoolId: poolId,
            provider: "EVOLUTION",
            instanceName: `central_${randomUUID()}`,
            status: "CONNECTING",
            ...proxy.data,
          },
        });
        created = true;
      } catch (error) {
        if ((error as { code?: string }).code !== "P2002") throw error;
        instance = await loadCentralInstance(access.organizationId);
      }
    } else if (instance.distributionPoolId !== poolId || instance.status !== "CONNECTING") {
      instance = await prisma.whatsAppInstance.update({
        where: { id: instance.id },
        data: { distributionPoolId: poolId, status: "CONNECTING" },
      });
    }
    if (!instance) return NextResponse.json({ error: "Não foi possível preparar a Central" }, { status: 500 });

    // A aba "Atendimentos" dos outros cargos passa a aparecer logo (ver central-visibility.ts).
    forgetCentralVisibility(access.organizationId);
    after(() => provisionCentral(access.organizationId, instance, created));
    return NextResponse.json({ status: "CONNECTING", pending: true }, { status: 202 });
  });
}

export async function DELETE() {
  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const instance = await loadCentralInstance(access.organizationId);
    if (!instance) return NextResponse.json({ ok: true });
    try {
      await logoutInstance(instance.instanceName);
      await deleteInstance(instance.instanceName);
    } catch (error) {
      console.error("[wa:central] falha externa ao desconectar; removendo vínculo local", error);
    }
    // Sem a instância (instanceId vira NULL) ninguém consegue mais responder
    // por ela: encerra os atendimentos abertos em vez de deixá-los presos nas
    // filas. O histórico continua em "Encerrados".
    await prisma.whatsAppThread.updateMany({
      where: { organizationId: access.organizationId, instanceId: instance.id, inboxStatus: "OPEN" },
      data: { inboxStatus: "CLOSED", closedAt: new Date() },
    });
    await prisma.whatsAppInstance.delete({ where: { id: instance.id } });
    forgetCentralVisibility(access.organizationId);
    await logAudit({
      organizationId: access.organizationId,
      actorUserId: access.userId,
      actorName: access.session?.user?.name ?? "Dono",
      action: "CENTRAL_SETTINGS_CHANGED",
      targetType: "WhatsAppInstance",
      targetId: instance.id,
      detail: "Central desconectada e removida",
    });
    return NextResponse.json({ ok: true });
  });
}
