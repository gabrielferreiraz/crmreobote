/**
 * Ponto único de envio de mensagem — usado tanto pela rota de chat manual
 * (app/api/whatsapp/messages/[threadId]/route.ts) quanto pela ação
 * SEND_WHATSAPP do motor de automações (lib/automations/engine.ts). Mantém a
 * regra (resolver a conversa, resolver a instância certa, despachar pro
 * endpoint certo do Evolution conforme o tipo, registrar) num só lugar em vez
 * de duplicada nos dois chamadores.
 *
 * Duas funções: `sendWhatsAppMessage` é a primitiva de verdade — recebe um
 * `threadId` já existente (a conversa já fixa qual instância/número usar,
 * então quem clica em "enviar" numa conversa sempre manda pelo número
 * daquela conversa, não pelo número de quem está logado — é assim que o
 * dono consegue ajudar um vendedor numa conversa, mandando "como se fosse"
 * o número dele). `sendWhatsAppMessageToContact` é o atalho pra quem só
 * conhece um `contactId` (automação, página do negócio) — acha ou cria a
 * conversa a partir do Contact e delega pra função de cima.
 */

import { prisma } from "@/lib/prisma";
import type { $Enums, Prisma } from "@/app/generated/prisma/client";
import {
  sendTextMessage,
  sendMediaMessage,
  sendAudioMessage,
  sendContactMessage,
  simulateTyping,
  type MessageRef,
} from "@/lib/evolution";
import * as metaWhatsApp from "@/lib/meta-whatsapp";
import { decryptSecret } from "@/lib/security/secret-crypto";
import { getOrCreateThreadForContact, touchThreadLastMessage } from "@/lib/whatsapp/threads";
import { signMediaKey } from "@/lib/whatsapp/media-token";

export class WhatsAppSendError extends Error {}

/**
 * Um usuário pode ter até duas linhas de WhatsAppInstance agora (uma por
 * provider — ver WhatsAppInstance.provider) — acha a que está CONECTADA;
 * entre as duas conectadas ao mesmo tempo (raro), prefere a API oficial da
 * Meta. Usado sempre que o código só conhece "de quem é o WhatsApp",
 * não uma conversa já aberta (que já fixa a instância pelo threadId).
 */
export async function resolveConnectedInstance(organizationId: string, userId: string) {
  const instances = await prisma.whatsAppInstance.findMany({ where: { organizationId, userId } });
  return (
    instances.find((i) => i.provider === "META_CLOUD" && i.status === "CONNECTED") ??
    instances.find((i) => i.provider === "EVOLUTION" && i.status === "CONNECTED") ??
    null
  );
}

/**
 * Mesmo critério de resolveConnectedInstance (Meta > Evolution quando as
 * duas estão conectadas), só que em lote pra vários donos de uma vez —
 * usado só onde um envio pode ter destinatários de VÁRIOS consultores numa
 * mesma operação (envio em massa a partir do Pipeline: cada negócio manda
 * pelo WhatsApp do PRÓPRIO dono, não de quem disparou o envio — ver
 * CampaignRecipient.instanceId no schema). Extraído aqui pra não duplicar
 * esse critério de novo em cada lugar que precisa da mesma resolução em
 * lote (app/api/deals/bulk-send-message/route.ts e a checagem de risco de
 * banimento que o diálogo consulta antes de disparar).
 */
export async function resolvePreferredInstancesByOwner(
  organizationId: string,
  ownerIds: string[],
): Promise<Map<string, { id: string; provider: $Enums.WhatsAppProvider }>> {
  if (ownerIds.length === 0) return new Map();

  const instances = await prisma.whatsAppInstance.findMany({
    where: { organizationId, userId: { in: ownerIds }, status: "CONNECTED" },
    select: { id: true, userId: true, provider: true },
  });

  const byOwnerId = new Map<string, { id: string; provider: $Enums.WhatsAppProvider }>();
  for (const provider of ["META_CLOUD", "EVOLUTION"] as const) {
    for (const instance of instances) {
      if (instance.provider === provider && !byOwnerId.has(instance.userId)) {
        byOwnerId.set(instance.userId, { id: instance.id, provider: instance.provider });
      }
    }
  }
  return byOwnerId;
}

type ContactMetadata = { name?: string; phone?: string };

/**
 * mediaUrl guarda a chave do R2 (upload nativo do composer) — o Evolution
 * precisa de uma URL que ele mesmo consiga baixar. Não usa URL assinada do
 * R2 aqui de propósito: o Evolution acrescenta um "?timestamp=" na URL antes
 * de baixar (visto no código-fonte dele), o que invalida a assinatura de uma
 * URL de query-string e o R2 responde 403 — por isso o proxy próprio em
 * app/api/whatsapp/media-file. O token de acesso (signMediaKey) vai como
 * segmento de PATH, não query string, pelo mesmo motivo — o "?timestamp="
 * que o Evolution acrescenta no fim não interfere no path.
 */
function buildEvolutionMediaUrl(mediaKey: string): string {
  if (!mediaKey.startsWith("whatsapp-media/")) return mediaKey; // já é uma URL externa
  const appUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, "");
  if (!appUrl) throw new WhatsAppSendError("NEXTAUTH_URL não configurado");
  const token = signMediaKey(mediaKey);
  return `${appUrl}/api/whatsapp/media-file/${token}/${mediaKey}`;
}

export type WhatsAppOutgoingMessage = {
  organizationId: string;
  threadId: string;
  /** Texto sempre obrigatório: é o corpo da mensagem de texto e a legenda/fallback dos demais tipos. */
  text: string;
  type?: $Enums.WhatsAppMessageType;
  mediaUrl?: string;
  metadata?: Record<string, unknown>;
  /** Id de outra WhatsAppMessage desta mesma conversa — responde a ela, igual ao "responder" do WhatsApp. */
  replyToId?: string;
  /** Só o motor de campanhas preenche isso — marca a mensagem como disparo de lista fria (ver relatórios). */
  campaignId?: string;
  /**
   * Só o motor de Automações preenche isso (SEND_WHATSAPP/SEND_SCRIPT, ver
   * lib/automations/engine.ts) — mesma ideia que campaignId acima, marca a
   * mensagem como vinda de uma regra em vez de digitada por alguém. Sustenta
   * a detecção de "atendente humano ativo recentemente" (ver
   * hasRecentHumanMessage em lib/automations/message-trigger.ts) e separa
   * mensagem de automação de mensagem manual nos relatórios.
   */
  automationRuleId?: string;
  /**
   * Só o motor de campanhas (lib/campaigns/engine.ts) preenche isso — simula
   * "digitando…" antes de mandar (ver simulateTyping em lib/evolution.ts).
   * Nunca usado em mensagem manual (o vendedor já está digitando de verdade)
   * nem em automação isolada (latência extra sem benefício de padrão, já que
   * é uma mensagem só, não uma sequência de disparo em massa).
   */
  simulateTypingFirst?: boolean;
  /**
   * Preenchido só quando quem está mandando (sessão logada) não é o dono da
   * instância dessa conversa — ex.: Dono usando "enviar como consultor" na
   * página de Cliente/Negócio. Puramente auditoria interna, nunca é
   * transmitido ao WhatsApp em si (ver WhatsAppMessage.sentByUserId).
   */
  sentByUserId?: string;
};

export async function sendWhatsAppMessage(params: WhatsAppOutgoingMessage): Promise<{ id: string }> {
  const { organizationId, threadId, text, type = "TEXT", mediaUrl, metadata, replyToId, campaignId, automationRuleId, simulateTypingFirst, sentByUserId } = params;

  const thread = await prisma.whatsAppThread.findFirst({ where: { id: threadId, organizationId } });
  if (!thread) throw new WhatsAppSendError("Conversa não encontrada");

  // instanceId null = instância foi apagada de verdade (dono desativado, ver
  // ownerUserId em prisma/schema.prisma) — a conversa continua existindo só
  // pra consulta (backup), nunca mais dá pra enviar por ela.
  const instance = thread.instanceId ? await prisma.whatsAppInstance.findUnique({ where: { id: thread.instanceId ?? undefined } }) : null;
  if (!instance || instance.status !== "CONNECTED") {
    throw new WhatsAppSendError("O WhatsApp desta conversa não está conectado no CRM");
  }

  let quoted: MessageRef | undefined; // formato Evolution/Baileys (key+message)
  let replyToWamid: string | undefined; // formato Meta (só o id da mensagem)
  if (replyToId) {
    // Só permite citar mensagem da mesma conversa — nunca aceita um id de
    // outra conversa/organização vindo do cliente.
    const quotedMessage = await prisma.whatsAppMessage.findFirst({
      where: { id: replyToId, organizationId, threadId },
      select: { rawPayload: true, externalId: true },
    });
    if (instance.provider === "META_CLOUD") {
      if (!quotedMessage?.externalId) throw new WhatsAppSendError("Mensagem original não encontrada pra responder");
      replyToWamid = quotedMessage.externalId;
    } else {
      if (!quotedMessage?.rawPayload) throw new WhatsAppSendError("Mensagem original não encontrada pra responder");
      quoted = quotedMessage.rawPayload as MessageRef;
    }
  }

  const fullNumber = `55${thread.phoneNormalized}`;

  // Só EVOLUTION (sessão WhatsApp Web/Baileys) — a Cloud API oficial da Meta
  // não tem conceito de "presença"/digitando pra mensagem iniciada por nós.
  if (simulateTypingFirst && instance.provider !== "META_CLOUD") {
    await simulateTyping(instance.instanceName, fullNumber, text.length);
  }

  let externalId: string | undefined;
  let rawPayload: MessageRef | undefined;

  try {
    if (instance.provider === "META_CLOUD") {
      if (!instance.metaPhoneNumberId || !instance.metaAccessToken) {
        throw new WhatsAppSendError("Conexão com a API oficial da Meta incompleta — reconecte em Configurações");
      }
      const accessToken = decryptSecret(instance.metaAccessToken);
      const phoneNumberId = instance.metaPhoneNumberId;

      switch (type) {
        case "IMAGE": {
          if (!mediaUrl) throw new WhatsAppSendError("Imagem é obrigatória");
          const result = await metaWhatsApp.sendMediaMessage(
            phoneNumberId,
            accessToken,
            fullNumber,
            { mediatype: "image", media: buildEvolutionMediaUrl(mediaUrl), caption: text },
            replyToWamid,
          );
          externalId = result.externalId;
          break;
        }
        case "AUDIO": {
          if (!mediaUrl) throw new WhatsAppSendError("Áudio é obrigatório");
          const result = await metaWhatsApp.sendAudioMessage(
            phoneNumberId,
            accessToken,
            fullNumber,
            buildEvolutionMediaUrl(mediaUrl),
            replyToWamid,
          );
          externalId = result.externalId;
          break;
        }
        case "CONTACT": {
          const meta = metadata as ContactMetadata | undefined;
          if (!meta?.name || !meta?.phone) throw new WhatsAppSendError("Nome e telefone do contato são obrigatórios");
          const result = await metaWhatsApp.sendContactMessage(
            phoneNumberId,
            accessToken,
            fullNumber,
            { name: meta.name, phone: meta.phone },
            replyToWamid,
          );
          externalId = result.externalId;
          break;
        }
        case "PIX":
        case "TEXT":
        default: {
          const result = await metaWhatsApp.sendTextMessage(phoneNumberId, accessToken, fullNumber, text, replyToWamid);
          externalId = result.externalId;
          break;
        }
      }
    } else {
      switch (type) {
        case "IMAGE": {
          if (!mediaUrl) throw new WhatsAppSendError("Imagem é obrigatória");
          const result = await sendMediaMessage(
            instance.instanceName,
            fullNumber,
            { mediatype: "image", media: buildEvolutionMediaUrl(mediaUrl), caption: text },
            quoted,
          );
          externalId = result.externalId;
          rawPayload = result.ref;
          break;
        }
        case "AUDIO": {
          if (!mediaUrl) throw new WhatsAppSendError("Áudio é obrigatório");
          const result = await sendAudioMessage(
            instance.instanceName,
            fullNumber,
            buildEvolutionMediaUrl(mediaUrl),
            quoted,
          );
          externalId = result.externalId;
          rawPayload = result.ref;
          break;
        }
        case "CONTACT": {
          const meta = metadata as ContactMetadata | undefined;
          if (!meta?.name || !meta?.phone) throw new WhatsAppSendError("Nome e telefone do contato são obrigatórios");
          const result = await sendContactMessage(
            instance.instanceName,
            fullNumber,
            { name: meta.name, phone: meta.phone },
            quoted,
          );
          externalId = result.externalId;
          rawPayload = result.ref;
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
          const result = await sendTextMessage(instance.instanceName, fullNumber, text, quoted);
          externalId = result.externalId;
          rawPayload = result.ref;
          break;
        }
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
      threadId,
      direction: "OUTBOUND",
      type,
      body: text,
      mediaUrl,
      metadata: metadata as Prisma.InputJsonValue | undefined,
      externalId,
      rawPayload: rawPayload as Prisma.InputJsonValue | undefined,
      replyToId,
      status: "SENT",
      campaignId,
      automationRuleId,
      sentByUserId: sentByUserId && sentByUserId !== instance.userId ? sentByUserId : undefined,
    },
  });
  await touchThreadLastMessage(threadId, message.createdAt);

  return { id: message.id };
}

export type WhatsAppOutgoingMessageToContact = Omit<WhatsAppOutgoingMessage, "threadId"> & {
  contactId: string;
  /** De quem é a instância a usar, quando a conversa ainda não existe (o vendedor responsável). */
  ownerId: string;
};

/**
 * Atalho pra quem só conhece um Contact (não uma conversa já aberta) — a
 * página do negócio e a ação SEND_WHATSAPP das automações usam este.
 */
export async function sendWhatsAppMessageToContact(
  params: WhatsAppOutgoingMessageToContact,
): Promise<{ id: string }> {
  const { organizationId, contactId, ownerId, ...rest } = params;

  const contact = await prisma.contact.findFirst({ where: { id: contactId, organizationId } });
  if (!contact) throw new WhatsAppSendError("Contato não encontrado");

  const instance = await resolveConnectedInstance(organizationId, ownerId);
  if (!instance) {
    throw new WhatsAppSendError("O responsável por este contato não tem WhatsApp conectado no CRM");
  }

  const thread = await getOrCreateThreadForContact({ organizationId, instance, contact });
  if (!thread) throw new WhatsAppSendError("Contato sem número de WhatsApp/celular cadastrado");

  return sendWhatsAppMessage({ organizationId, threadId: thread.id, ...rest });
}
