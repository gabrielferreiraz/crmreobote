import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
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
  WEBHOOK_EVENTS,
} from "@/lib/evolution";
import { validateProxyInput, buildEvolutionProxyPayload, type ProxyInput } from "@/lib/whatsapp/proxy";

export const dynamic = "force-dynamic";

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
      const state = await getConnectionState(instance.instanceName);
      status = state === "open" ? "CONNECTED" : state === "connecting" ? "CONNECTING" : "DISCONNECTED";
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

    // Diagnóstico + auto-cura: confirma no lado do Evolution (fonte da
    // verdade real) se o webhook está habilitado e com a URL certa. Se a URL
    // gravada não bate com a atual (ex.: instância criada quando
    // NEXTAUTH_URL ainda apontava pra localhost), corrige na hora — sem isso
    // a instância ficaria "conectada" pra sempre sem nunca receber mensagem
    // nenhuma, e ninguém perceberia até reparar nos logs.
    try {
      const webhookConfig = await getWebhookConfig(instance.instanceName);
      const expectedUrl = buildWebhookUrl();
      const missingEvents = WEBHOOK_EVENTS.filter((e) => !webhookConfig?.events?.includes(e));
      console.log(
        `[wa:webhook-config] instância=${instance.instanceName} enabled=${webhookConfig?.enabled} url="${webhookConfig?.url}" esperado="${expectedUrl}" events=${JSON.stringify(webhookConfig?.events)} faltando=${JSON.stringify(missingEvents)}`,
      );
      if (webhookConfig && (!webhookConfig.enabled || webhookConfig.url !== expectedUrl || missingEvents.length > 0)) {
        console.warn(
          `[wa:webhook-config] config divergente para ${instance.instanceName} (url ou eventos ${JSON.stringify(missingEvents)}) — reconfigurando`,
        );
        await setWebhookConfig(instance.instanceName, expectedUrl);
      }
    } catch (err) {
      console.error(`[wa:webhook-config] falha ao verificar/corrigir webhook de ${instance.instanceName}`, err);
    }

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
  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  // proxy é opcional — só usado se a instância ainda não existir (aplicado
  // na criação; trocar depois exige desconectar e reconectar, ver
  // lib/whatsapp/proxy.ts).
  const body = await req.json().catch(() => ({}));
  const proxyValidation = validateProxyInput((body as { proxy?: ProxyInput }).proxy);
  if (!proxyValidation.ok) return NextResponse.json({ error: proxyValidation.error }, { status: 400 });

  return runWithTenant(organizationId, async () => {
    let instance = await prisma.whatsAppInstance.findUnique({
      where: { organizationId_userId_provider: { organizationId, userId, provider: "EVOLUTION" } },
    });

    if (!instance) {
      // instanceName é um identificador aleatório próprio, não derivado de
      // organizationId/userId — nunca revela a qual organização pertence só de
      // olhar pra ele.
      const instanceName = `wa_${randomUUID()}`;
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

      try {
        await createInstance(instance.instanceName, buildWebhookUrl(), buildEvolutionProxyPayload(instance));
      } catch {
        await prisma.whatsAppInstance.delete({ where: { id: instance.id } });
        return NextResponse.json(
          { error: "Não foi possível criar a instância no WhatsApp. Tente novamente." },
          { status: 502 },
        );
      }
    }

    try {
      const qr = await getQrCode(instance.instanceName);
      return NextResponse.json({ qrCode: qr.base64 ?? null, pairingCode: qr.pairingCode ?? null });
    } catch {
      return NextResponse.json({ error: "Não foi possível gerar o QR Code. Tente novamente." }, { status: 502 });
    }
  });
}

export async function DELETE() {
  const { organizationId, userId } = await requireSession();
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
    return NextResponse.json({ ok: true });
  });
}
