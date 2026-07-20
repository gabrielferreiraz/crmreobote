/**
 * Interpretação dos eventos de webhook da API oficial da Meta (Cloud API) —
 * espelha lib/whatsapp/events.ts, mas pro formato de payload completamente
 * diferente da Meta (entry[].changes[].value.{messages[],statuses[]}
 * estruturado, não o formato cru do Baileys). Arquivo separado de propósito,
 * mesmo motivo do arquivo original: se o formato de algum campo mudar entre
 * versões do Graph API, o ajuste fica só aqui.
 *
 * Diferenças estruturais em relação ao Evolution que valem lembrar:
 * - A Meta só manda `messages[]` pra mensagem RECEBIDA (nunca ecoa de volta
 *   o que a própria organização mandou pela API — diferente do Baileys, que
 *   ecoa tudo). Por isso não existe checagem de `fromMe`/direção aqui: todo
 *   item de `messages[]` é sempre INBOUND.
 * - Não existe conceito de "conexão caindo" (connection.update) nem de
 *   histórico (messages.set) — um número Cloud API não tem sessão pra cair,
 *   e a Meta não expõe pull de histórico antigo.
 */

import { prisma } from "@/lib/prisma";
import { normalizePhoneNumber, formatBrazilianPhone } from "@/lib/phone-normalize";
import { downloadMedia } from "@/lib/meta-whatsapp";
import { decryptSecret } from "@/lib/security/secret-crypto";
import { assertValidChatMedia, buildChatMediaKey, uploadChatMedia, ChatMediaUploadError } from "@/lib/r2";
import { getOrCreateThread } from "@/lib/whatsapp/threads";
import { sendPushToUser } from "@/lib/push";
import { handleCampaignReply } from "@/lib/campaigns/reply";
import type { $Enums } from "@/app/generated/prisma/client";

const DEBUG_LOG_ENABLED = process.env.WHATSAPP_WEBHOOK_DEBUG_LOG === "true" || process.env.NODE_ENV !== "production";

/** Mesma ideia de lib/whatsapp/events.ts's debugLog — payload/texto de mensagem é PII, só loga em modo debug. */
function debugLog(...args: unknown[]): void {
  if (DEBUG_LOG_ENABLED) console.log(...args);
}

export type InstanceRef = {
  id: string;
  organizationId: string;
  userId: string;
  status: $Enums.WhatsAppInstanceStatus;
  notifyOnCrmMessage: boolean;
  notifyOnGeralMessage: boolean;
  metaAccessToken: string | null;
};

export type MetaMessage = {
  from?: string;
  id?: string;
  type?: string;
  text?: { body?: string };
  image?: { id?: string; caption?: string; mime_type?: string };
  audio?: { id?: string; mime_type?: string };
  sticker?: { id?: string; mime_type?: string };
  context?: { message_id?: string };
};

export type MetaStatus = { id?: string; status?: string };

export type MetaContact = { profile?: { name?: string }; wa_id?: string };

const STATUS_MAP: Record<string, $Enums.WhatsAppMessageStatus> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

async function saveIncomingMetaMessage(
  instance: InstanceRef,
  msg: MetaMessage,
  contactProfile: MetaContact | undefined,
): Promise<void> {
  const rawNumber = msg.from;
  if (!rawNumber) {
    debugLog("[wa:meta-webhook] ignorada: sem from", JSON.stringify(msg));
    return;
  }
  const normalized = normalizePhoneNumber(rawNumber);
  if (!normalized) {
    console.log("[wa:meta-webhook] ignorada: número não normalizável");
    return;
  }

  const thread = await getOrCreateThread({
    organizationId: instance.organizationId,
    instanceId: instance.id,
    phoneNormalized: normalized,
    whatsappName: contactProfile?.profile?.name,
  });
  debugLog(`[wa:meta-webhook] from=${rawNumber} → normalizado=${normalized} → thread=${thread.id} contactId=${thread.contactId ?? "—"}`);

  const externalId = msg.id;
  if (externalId) {
    const existing = await prisma.whatsAppMessage.findUnique({ where: { externalId }, select: { id: true } });
    if (existing) {
      console.log(`[wa:meta-webhook] ignorada: externalId ${externalId} já registrado`);
      return;
    }
  }

  let body: string | null = null;
  let type: $Enums.WhatsAppMessageType = "TEXT";
  let mediaUrl: string | undefined;

  if (msg.type === "text") {
    body = msg.text?.body ?? null;
  } else if (msg.type === "image" || msg.type === "audio" || msg.type === "sticker") {
    const mediaField = msg.type === "image" ? msg.image : msg.type === "audio" ? msg.audio : msg.sticker;
    const mediaId = mediaField?.id;
    if (mediaId && instance.metaAccessToken) {
      console.log(`[wa:meta-webhook] mensagem contém mídia (${msg.type}) — baixando via Graph API...`);
      const media = await downloadMedia(mediaId, decryptSecret(instance.metaAccessToken));
      if (!media) {
        console.warn("[wa:meta-webhook] Graph API não retornou a mídia (pode ter expirado)");
      } else {
        try {
          const buffer = Buffer.from(media.base64, "base64");
          assertValidChatMedia(media.mimetype, buffer.length, buffer);
          const key = buildChatMediaKey(instance.organizationId, media.mimetype);
          await uploadChatMedia(key, buffer, media.mimetype);
          type = msg.type === "image" ? "IMAGE" : msg.type === "audio" ? "AUDIO" : "STICKER";
          mediaUrl = key;
          body = msg.type === "image" ? (msg.image?.caption ?? null) : null;
          console.log(`[wa:meta-webhook] mídia baixada e salva no R2: key=${key} mimetype=${media.mimetype} tamanho=${buffer.length} bytes`);
        } catch (err) {
          const reason = err instanceof ChatMediaUploadError ? err.message : String(err);
          console.error(`[wa:meta-webhook] falha ao salvar mídia recebida no R2: ${reason}`);
        }
      }
    }
  } else {
    // location/contacts/interactive/etc. — não suportado nessa entrega;
    // registra como texto genérico pra não perder o evento em silêncio.
    body = `[mensagem do tipo "${msg.type}" ainda não suportada]`;
  }

  let replyToId: string | undefined;
  const quotedWamid = msg.context?.message_id;
  if (quotedWamid) {
    const quotedMessage = await prisma.whatsAppMessage.findUnique({
      where: { externalId: quotedWamid },
      select: { id: true },
    });
    replyToId = quotedMessage?.id;
  }

  const saved = await prisma.whatsAppMessage.create({
    data: {
      organizationId: instance.organizationId,
      instanceId: instance.id,
      threadId: thread.id,
      // A Meta só manda messages[] pra mensagem recebida (nunca ecoa envio
      // próprio) — diferente do Evolution, aqui é sempre INBOUND.
      direction: "INBOUND",
      type,
      body,
      mediaUrl,
      externalId: externalId ?? undefined,
      replyToId,
      status: "DELIVERED",
    },
  });
  debugLog(`[wa:meta-webhook] mensagem salva: id=${saved.id} type=${type} body="${body}" mediaUrl=${mediaUrl ?? "—"}`);

  const shouldNotify = thread.contactId ? instance.notifyOnCrmMessage : instance.notifyOnGeralMessage;
  if (shouldNotify) {
    let displayName = thread.whatsappName ?? formatBrazilianPhone(normalized) ?? normalized;
    if (thread.contactId) {
      const contact = await prisma.contact.findUnique({ where: { id: thread.contactId }, select: { name: true } });
      if (contact) displayName = contact.name;
    }
    const preview =
      body ||
      (type === "IMAGE" ? "📷 Imagem" : type === "AUDIO" ? "🎵 Áudio" : type === "STICKER" ? "🧩 Figurinha" : "Nova mensagem");
    sendPushToUser(instance.userId, { title: displayName, body: preview, url: "/whatsapp/conversas" }).catch((err) =>
      console.error("[wa:meta-webhook] falha ao enviar push de mensagem recebida", err),
    );
  }

  handleCampaignReply(instance.organizationId, thread.id, thread.contactId).catch((err) =>
    console.error("[wa:meta-webhook] falha ao processar resposta de campanha", err),
  );
}

export async function handleMetaMessages(instance: InstanceRef, messages: MetaMessage[], contacts: MetaContact[]): Promise<void> {
  for (const msg of messages) {
    try {
      const contactProfile = contacts.find((c) => c.wa_id === msg.from);
      await saveIncomingMetaMessage(instance, msg, contactProfile);
    } catch (err) {
      // Mesma regra do Evolution: um item mal-formado nunca deve derrubar a
      // resposta 200 que a Meta espera, ou ela reenvia o mesmo evento à toa.
      console.error("[wa:meta-webhook] falha ao processar mensagem recebida", err);
    }
  }
}

/** Status de entrega/leitura — statuses[] não carrega phone_number_id próprio, já veio filtrado pelo metadata do change. */
export async function handleMetaStatuses(organizationId: string, statuses: MetaStatus[]): Promise<void> {
  for (const s of statuses) {
    if (!s.id || !s.status) continue;
    const mapped = STATUS_MAP[s.status];
    if (!mapped) continue;
    try {
      await prisma.whatsAppMessage.updateMany({ where: { organizationId, externalId: s.id }, data: { status: mapped } });
    } catch (err) {
      console.error(`[wa:meta-webhook] falha ao atualizar status de ${s.id}`, err);
    }
  }
}
