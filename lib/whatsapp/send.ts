/**
 * Ponto único de envio de mensagem — usado tanto pela rota de chat manual
 * (app/api/whatsapp/messages/[contactId]/route.ts) quanto pela ação
 * SEND_WHATSAPP do motor de automações (lib/automations/engine.ts). Mantém a
 * regra (resolver contato, resolver instância do responsável, despachar pro
 * endpoint certo do Evolution conforme o tipo, registrar) num só lugar em vez
 * de duplicada nos dois chamadores.
 */

import { prisma } from "@/lib/prisma";
import type { $Enums, Prisma } from "@/app/generated/prisma/client";
import {
  sendTextMessage,
  sendMediaMessage,
  sendAudioMessage,
  sendContactMessage,
  sendButtonsMessage,
  sendListMessage,
} from "@/lib/evolution";
import { normalizePhoneNumber } from "@/lib/phone-normalize";
import { resolveChatMediaUrl } from "@/lib/r2";

export class WhatsAppSendError extends Error {}

type ContactMetadata = { name?: string; phone?: string };
type ButtonsMetadata = { buttons?: { label: string }[] };
type ListMetadata = { items?: { title: string; description?: string }[] };

export type WhatsAppOutgoingMessage = {
  organizationId: string;
  contactId: string;
  ownerId: string;
  /** Texto sempre obrigatório: é o corpo da mensagem de texto e a legenda/fallback dos demais tipos. */
  text: string;
  type?: $Enums.WhatsAppMessageType;
  mediaUrl?: string;
  metadata?: Record<string, unknown>;
};

export async function sendWhatsAppMessage(params: WhatsAppOutgoingMessage): Promise<{ id: string }> {
  const { organizationId, contactId, ownerId, text, type = "TEXT", mediaUrl, metadata } = params;

  const contact = await prisma.contact.findFirst({ where: { id: contactId, organizationId } });
  if (!contact) throw new WhatsAppSendError("Contato não encontrado");

  // WhatsApp é o número principal; celular (nº 2) só entra se não houver WhatsApp.
  const number = normalizePhoneNumber(contact.whatsapp || contact.phone);
  if (!number) throw new WhatsAppSendError("Contato sem número de WhatsApp/celular cadastrado");

  const instance = await prisma.whatsAppInstance.findUnique({
    where: { organizationId_userId: { organizationId, userId: ownerId } },
  });
  if (!instance || instance.status !== "CONNECTED") {
    throw new WhatsAppSendError("O responsável por este contato não tem WhatsApp conectado no CRM");
  }

  const fullNumber = `55${number}`;
  let externalId: string | undefined;

  try {
    switch (type) {
      case "IMAGE": {
        if (!mediaUrl) throw new WhatsAppSendError("Imagem é obrigatória");
        // mediaUrl guarda a chave do R2 (upload nativo) — o Evolution precisa
        // de uma URL que ele mesmo consiga baixar, então resolve uma URL
        // assinada só na hora do envio; o que fica salvo no banco é a chave.
        const downloadUrl = await resolveChatMediaUrl(mediaUrl);
        if (!downloadUrl) throw new WhatsAppSendError("Não foi possível gerar a URL da imagem");
        const result = await sendMediaMessage(instance.instanceName, fullNumber, {
          mediatype: "image",
          media: downloadUrl,
          caption: text,
        });
        externalId = result.externalId;
        break;
      }
      case "AUDIO": {
        if (!mediaUrl) throw new WhatsAppSendError("Áudio é obrigatório");
        const downloadUrl = await resolveChatMediaUrl(mediaUrl);
        if (!downloadUrl) throw new WhatsAppSendError("Não foi possível gerar a URL do áudio");
        const result = await sendAudioMessage(instance.instanceName, fullNumber, downloadUrl);
        externalId = result.externalId;
        break;
      }
      case "CONTACT": {
        const meta = metadata as ContactMetadata | undefined;
        if (!meta?.name || !meta?.phone) throw new WhatsAppSendError("Nome e telefone do contato são obrigatórios");
        const result = await sendContactMessage(instance.instanceName, fullNumber, {
          name: meta.name,
          phone: meta.phone,
        });
        externalId = result.externalId;
        break;
      }
      case "BUTTONS": {
        const meta = metadata as ButtonsMetadata | undefined;
        if (!meta?.buttons?.length) throw new WhatsAppSendError("Pelo menos um botão é obrigatório");
        const result = await sendButtonsMessage(instance.instanceName, fullNumber, {
          text,
          buttons: meta.buttons,
        });
        externalId = result.externalId;
        break;
      }
      case "LIST": {
        const meta = metadata as ListMetadata | undefined;
        if (!meta?.items?.length) throw new WhatsAppSendError("Pelo menos um item de lista é obrigatório");
        const result = await sendListMessage(instance.instanceName, fullNumber, {
          title: text,
          items: meta.items,
        });
        externalId = result.externalId;
        break;
      }
      case "PIX":
      case "TEXT":
      default: {
        // Pix não tem integração real com provedor de pagamento ainda (é
        // decisão de produto, não só técnica) — envia como texto formatado
        // mesmo; o cartão visual rico continua aparecendo no CRM via
        // type + metadata salvos abaixo.
        const result = await sendTextMessage(instance.instanceName, fullNumber, text);
        externalId = result.externalId;
        break;
      }
    }
  } catch (err) {
    if (err instanceof WhatsAppSendError) throw err;
    throw new WhatsAppSendError("Falha ao enviar a mensagem pelo WhatsApp. Tente novamente.");
  }

  const message = await prisma.whatsAppMessage.create({
    data: {
      organizationId,
      instanceId: instance.id,
      contactId,
      direction: "OUTBOUND",
      type,
      body: text,
      mediaUrl,
      metadata: metadata as Prisma.InputJsonValue | undefined,
      externalId,
      status: "SENT",
    },
  });

  return { id: message.id };
}
