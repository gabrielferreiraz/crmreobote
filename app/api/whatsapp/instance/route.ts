import { randomUUID } from "crypto";
import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import {
  createInstance,
  getQrCode,
  getConnectionState,
  getWebhookConfig,
  setWebhookConfig,
  logoutInstance,
  deleteInstance,
  EvolutionApiError,
  WEBHOOK_EVENTS,
} from "@/lib/evolution";
import { validateProxyInput, buildEvolutionProxyPayload, type ProxyInput } from "@/lib/whatsapp/proxy";
import { provisionEvolutionConnection } from "@/lib/whatsapp/provision-evolution";
import { logAudit } from "@/lib/audit-log";
import { getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATUS_TIMEOUT_MS = 5_000;
const QR_TIMEOUT_MS = 10_000;
const WEBHOOK_CHECK_INTERVAL_MS = 15 * 60 * 1_000;
const PROVISIONING_GRACE_MS = 2 * 60 * 1_000;

type ProvisionInput = {
  organizationId: string;
  instanceId: string;
  instanceName: string;
  created: boolean;
  webhookUrl: string;
  proxy: ReturnType<typeof buildEvolutionProxyPayload>;
  audit: {
    actorUserId: string;
    actorName: string;
    ip: string;
  };
};

const globalForWhatsApp = globalThis as unknown as {
  whatsappProvisioningTasks?: Map<string, Promise<void>>;
  whatsappWebhookChecks?: Map<string, number>;
};

const provisioningTasks = globalForWhatsApp.whatsappProvisioningTasks ?? new Map<string, Promise<void>>();
const webhookChecks = globalForWhatsApp.whatsappWebhookChecks ?? new Map<string, number>();

globalForWhatsApp.whatsappProvisioningTasks = provisioningTasks;
globalForWhatsApp.whatsappWebhookChecks = webhookChecks;

function buildWebhookUrl(): string {
  const appUrl = process.env.NEXTAUTH_URL;
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET;
  if (!appUrl || !secret) {
    throw new Error("NEXTAUTH_URL/EVOLUTION_WEBHOOK_SECRET não configurados");
  }
  // O segredo vai na própria URL do webhook (não como header) porque nem toda
  // versão do Evolution permite configurar headers customizados no webhook —
  // a URL é a forma mais garantida de autenticar quem está nos chamando.
  return `${appUrl}/api/whatsapp/webhook?secret=${encodeURIComponent(secret)}`;
}

function isMissingEvolutionInstance(error: unknown): boolean {
  return error instanceof EvolutionApiError && error.status === 404;
}

async function updateInstanceStatus(instanceId: string, status: "DISCONNECTED" | "CONNECTING" | "CONNECTED") {
  await prisma.whatsAppInstance.updateMany({ where: { id: instanceId }, data: { status } });
}

async function repairWebhookConfig(organizationId: string, instanceName: string, expectedUrl: string) {
  await runWithTenant(organizationId, async () => {
    try {
      const webhookConfig = await getWebhookConfig(instanceName);
      if (!webhookConfig) return;

      const missingEvents = WEBHOOK_EVENTS.filter((event) => !webhookConfig.events?.includes(event));
      if (!webhookConfig.enabled || webhookConfig.url !== expectedUrl || missingEvents.length > 0) {
        console.warn(
          `[wa:webhook-config] configuração divergente para ${instanceName}; reconfigurando (${missingEvents.length} evento(s) ausente(s))`,
        );
        await setWebhookConfig(instanceName, expectedUrl);
      }
    } catch (error) {
      console.error(`[wa:webhook-config] falha ao verificar/corrigir webhook de ${instanceName}`, error);
    }
  });
}

function scheduleWebhookCheck(organizationId: string, instanceName: string) {
  const now = Date.now();
  const lastCheck = webhookChecks.get(instanceName) ?? 0;
  if (now - lastCheck < WEBHOOK_CHECK_INTERVAL_MS) return;

  try {
    const expectedUrl = buildWebhookUrl();
    webhookChecks.set(instanceName, now);
    after(() => repairWebhookConfig(organizationId, instanceName, expectedUrl));
  } catch (error) {
    console.error("[wa:webhook-config] configuração do webhook indisponível", error);
  }
}

async function provisionEvolutionInstance(input: ProvisionInput): Promise<void> {
  await runWithTenant(input.organizationId, async () => {
    const result = await provisionEvolutionConnection(input.created, {
      create: () => createInstance(input.instanceName, input.webhookUrl, input.proxy),
      getState: () => getConnectionState(input.instanceName, STATUS_TIMEOUT_MS),
      getQrCode: () => getQrCode(input.instanceName, QR_TIMEOUT_MS),
      isMissingInstance: isMissingEvolutionInstance,
      delay: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    });

    await updateInstanceStatus(input.instanceId, result.status);

    if (result.recoveredAfterAmbiguousFailure) {
      console.warn(`[wa:provision] criação de ${input.instanceName} confirmou QR após resposta inconclusiva`);
    }
    if (result.error) {
      console.error(`[wa:provision] falha ao preparar ${input.instanceName}`, result.error);
      return;
    }

    if (input.created) {
      await logAudit({
        organizationId: input.organizationId,
        actorUserId: input.audit.actorUserId,
        actorName: input.audit.actorName,
        action: "WHATSAPP_CONNECTED",
        targetType: "WhatsAppInstance",
        targetId: input.instanceId,
        detail: "Evolution (QR Code)",
        ip: input.audit.ip,
      });
    }
  });
}

function provisionOnce(input: ProvisionInput): Promise<void> {
  const running = provisioningTasks.get(input.instanceName);
  if (running) return running;

  const task = provisionEvolutionInstance(input)
    .catch((error) => {
      console.error(`[wa:provision] falha interna ao preparar ${input.instanceName}`, error);
    })
    .finally(() => {
      provisioningTasks.delete(input.instanceName);
    });
  provisioningTasks.set(input.instanceName, task);
  return task;
}

export async function GET() {
  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const instance = await prisma.whatsAppInstance.findUnique({
      where: { organizationId_userId_provider: { organizationId, userId, provider: "EVOLUTION" } },
    });
    if (!instance) return NextResponse.json({ connected: false, status: "DISCONNECTED", phoneNumber: null });

    // Reconsulta o status real no Evolution — não confia só no que está gravado,
    // já que a conexão pode ter caído do lado do WhatsApp sem a gente saber.
    let status = instance.status;
    try {
      const state = await getConnectionState(instance.instanceName, STATUS_TIMEOUT_MS);
      status = state === "open" ? "CONNECTED" : state === "connecting" ? "CONNECTING" : "DISCONNECTED";
      if (
        instance.status === "CONNECTING" &&
        status === "DISCONNECTED" &&
        Date.now() - instance.updatedAt.getTime() < PROVISIONING_GRACE_MS
      ) {
        status = "CONNECTING";
      }
      // Não persiste "CONNECTING" por cima de um CONNECTED/DISCONNECTED já
      // gravado — mesmo blip passageiro do Evolution que lib/whatsapp/events.ts
      // já protege no webhook (ver comentário lá); aqui também precisa, senão
      // esta tela sozinha já corrompe o status que a detecção de transição do
      // webhook usa como base pro próximo evento. A resposta abaixo ainda
      // reflete a leitura ao vivo, só não grava.
      if (status !== "CONNECTING" && status !== instance.status) {
        await prisma.whatsAppInstance.update({ where: { id: instance.id }, data: { status } });
      }
    } catch {
      // Evolution fora do ar não deve quebrar a tela de configurações — mostra
      // o último status conhecido em vez de propagar o erro.
    }

    // A verificação do webhook é importante, mas não precisa segurar a tela.
    // No máximo uma vez a cada 15 minutos por instância, roda após a resposta.
    if (status === "CONNECTED") scheduleWebhookCheck(organizationId, instance.instanceName);

    return NextResponse.json({
      connected: status === "CONNECTED",
      status,
      phoneNumber: instance.phoneNumber,
      notifyOnCrmMessage: instance.notifyOnCrmMessage,
      notifyOnGeralMessage: instance.notifyOnGeralMessage,
    });
  });
}

export async function PATCH(req: Request) {
  const body = await req.json();
  const { notifyOnCrmMessage, notifyOnGeralMessage } = body as {
    notifyOnCrmMessage?: boolean;
    notifyOnGeralMessage?: boolean;
  };

  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const instance = await prisma.whatsAppInstance.findUnique({
      where: { organizationId_userId_provider: { organizationId, userId, provider: "EVOLUTION" } },
    });
    if (!instance) return NextResponse.json({ error: "Nenhum WhatsApp conectado" }, { status: 404 });

    const updated = await prisma.whatsAppInstance.update({
      where: { id: instance.id },
      data: {
        ...(notifyOnCrmMessage !== undefined ? { notifyOnCrmMessage } : {}),
        ...(notifyOnGeralMessage !== undefined ? { notifyOnGeralMessage } : {}),
      },
    });

    return NextResponse.json({
      notifyOnCrmMessage: updated.notifyOnCrmMessage,
      notifyOnGeralMessage: updated.notifyOnGeralMessage,
    });
  });
}

export async function POST(req: Request) {
  const { organizationId, userId, session } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  // proxy é opcional — só usado se a instância ainda não existir (aplicado
  // na criação; trocar depois exige desconectar e reconectar, ver
  // lib/whatsapp/proxy.ts).
  const body = await req.json().catch(() => ({}));
  const proxyValidation = validateProxyInput((body as { proxy?: ProxyInput }).proxy);
  if (!proxyValidation.ok) return NextResponse.json({ error: proxyValidation.error }, { status: 400 });

  let webhookUrl: string;
  try {
    webhookUrl = buildWebhookUrl();
  } catch (error) {
    console.error("[wa:provision] configuração do webhook indisponível", error);
    return NextResponse.json(
      { error: "A conexão do WhatsApp está temporariamente indisponível." },
      { status: 503 },
    );
  }

  return runWithTenant(organizationId, async () => {
    let instance = await prisma.whatsAppInstance.findUnique({
      where: { organizationId_userId_provider: { organizationId, userId, provider: "EVOLUTION" } },
    });
    let created = false;

    if (!instance) {
      // instanceName é um identificador aleatório próprio, não derivado de
      // organizationId/userId — nunca revela a qual organização pertence só de
      // olhar pra ele.
      const instanceName = `wa_${randomUUID()}`;
      try {
        instance = await prisma.whatsAppInstance.create({
          data: {
            organizationId,
            userId,
            provider: "EVOLUTION",
            instanceName,
            status: "CONNECTING",
            ...proxyValidation.data,
          },
        });
        created = true;
      } catch (error) {
        if ((error as { code?: string }).code !== "P2002") throw error;
        instance = await prisma.whatsAppInstance.findUnique({
          where: { organizationId_userId_provider: { organizationId, userId, provider: "EVOLUTION" } },
        });
      }
    }

    if (!instance) {
      return NextResponse.json({ error: "Não foi possível preparar a conexão. Tente novamente." }, { status: 500 });
    }

    if (instance.status === "CONNECTED") {
      return NextResponse.json({ connected: true, status: "CONNECTED" });
    }

    if (instance.status !== "CONNECTING") {
      instance = await prisma.whatsAppInstance.update({
        where: { id: instance.id },
        data: { status: "CONNECTING" },
      });
    }

    const input: ProvisionInput = {
      organizationId,
      instanceId: instance.id,
      instanceName: instance.instanceName,
      created,
      webhookUrl,
      proxy: buildEvolutionProxyPayload(instance),
      audit: {
        actorUserId: userId,
        actorName: session!.user.name ?? session!.user.email ?? "?",
        ip: getClientIp(req),
      },
    };

    // Responde antes da chamada potencialmente lenta à Evolution. O frontend
    // passa a consultar o QR separadamente, sem depender do timeout do proxy.
    after(() => provisionOnce(input));
    return NextResponse.json({ connected: false, status: "CONNECTING", pending: true }, { status: 202 });
  });
}

export async function DELETE(req: Request) {
  const { organizationId, userId, session } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const instance = await prisma.whatsAppInstance.findUnique({
      where: { organizationId_userId_provider: { organizationId, userId, provider: "EVOLUTION" } },
    });
    if (!instance) return NextResponse.json({ ok: true });

    try {
      await logoutInstance(instance.instanceName);
      await deleteInstance(instance.instanceName);
    } catch {
      // Segue removendo do nosso lado mesmo se o Evolution já tiver perdido a
      // sessão (ex.: usuário desconectou direto pelo celular).
    }

    await prisma.whatsAppInstance.delete({ where: { id: instance.id } });

    await logAudit({
      organizationId,
      actorUserId: userId,
      actorName: session!.user.name ?? session!.user.email ?? "?",
      action: "WHATSAPP_DISCONNECTED",
      targetType: "WhatsAppInstance",
      targetId: instance.id,
      detail: "Evolution",
      ip: getClientIp(req),
    });

    return NextResponse.json({ ok: true });
  });
}
