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
  logoutInstance,
  deleteInstance,
} from "@/lib/evolution";

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
      where: { organizationId_userId: { organizationId, userId } },
    });
    if (!instance) return NextResponse.json({ connected: false, status: "DISCONNECTED", phoneNumber: null });

    // Reconsulta o status real no Evolution — não confia só no que está gravado,
    // já que a conexão pode ter caído do lado do WhatsApp sem a gente saber.
    let status = instance.status;
    try {
      const state = await getConnectionState(instance.instanceName);
      status = state === "open" ? "CONNECTED" : state === "connecting" ? "CONNECTING" : "DISCONNECTED";
      if (status !== instance.status) {
        await prisma.whatsAppInstance.update({ where: { id: instance.id }, data: { status } });
      }
    } catch {
      // Evolution fora do ar não deve quebrar a tela de configurações — mostra
      // o último status conhecido em vez de propagar o erro.
    }

    // Diagnóstico: confirma no lado do Evolution (fonte da verdade real) se o
    // webhook está de fato habilitado e com os eventos certos — não custa
    // nada nessa checagem já periódica, e é a única forma de provar (em vez
    // de supor) por que mensagens recebidas não estão chegando no CRM.
    const webhookConfig = await getWebhookConfig(instance.instanceName);
    console.log(
      `[wa:webhook-config] instância=${instance.instanceName} enabled=${webhookConfig?.enabled} url=${webhookConfig?.url} events=${JSON.stringify(webhookConfig?.events)}`,
    );

    return NextResponse.json({
      connected: status === "CONNECTED",
      status,
      phoneNumber: instance.phoneNumber,
    });
  });
}

export async function POST() {
  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    let instance = await prisma.whatsAppInstance.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });

    if (!instance) {
      // instanceName é um identificador aleatório próprio, não derivado de
      // organizationId/userId — nunca revela a qual organização pertence só de
      // olhar pra ele.
      const instanceName = `wa_${randomUUID()}`;
      instance = await prisma.whatsAppInstance.create({
        data: { organizationId, userId, instanceName, status: "CONNECTING" },
      });

      try {
        await createInstance(instance.instanceName, buildWebhookUrl());
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
      where: { organizationId_userId: { organizationId, userId } },
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
