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
import { sendTextMessage, sendMediaMessage, sendAudioMessage, sendContactMessage } from "@/lib/evolution";
import { normalizePhoneNumber } from "@/lib/phone-normalize";

export class WhatsAppSendError extends Error {}

type ContactMetadata = { name?: string; phone?: string };

/**
 * mediaUrl guarda a chave do R2 (upload nativo do composer) — o Evolution
 * precisa de uma URL que ele mesmo consiga baixar. Não usa URL assinada do
 * R2 aqui de propósito: o Evolution acrescenta um "?timestamp=" na URL antes
 * de baixar (visto no código-fonte dele), o que invalida a assinatura de uma
 * URL de query-string e o R2 responde 403 — por isso o proxy próprio em
 * app/api/whatsapp/media-file, que ignora qualquer query string extra.
 */
function buildEvolutionMediaUrl(mediaKey: string): string {
  if (!mediaKey.startsWith("whatsapp-media/")) return mediaKey; // já é uma URL externa
  const appUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, "");
  if (!appUrl) throw new WhatsAppSendError("NEXTAUTH_URL não configurado");
  return `${appUrl}/api/whatsapp/media-file/${mediaKey}`;
}

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
        const result = await sendMediaMessage(instance.instanceName, fullNumber, {
          mediatype: "image",
          media: buildEvolutionMediaUrl(mediaUrl),
          caption: text,
        });
        externalId = result.externalId;
        break;
      }
      case "AUDIO": {
        if (!mediaUrl) throw new WhatsAppSendError("Áudio é obrigatório");
        const result = await sendAudioMessage(instance.instanceName, fullNumber, buildEvolutionMediaUrl(mediaUrl));
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
      case "PIX":
      case "TEXT":
      default: {
        // BUTTONS/LIST não são mais enviáveis (removido: o Baileys simula
        // isso via truque não-oficial que a Meta não garante entregar/
        // renderizar — confirmado em produção que não chegava ao
        // destinatário). Se algum dado antigo ainda vier com esse type,
        // cai aqui e manda como texto normal.
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
