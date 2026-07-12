/**
 * Interpretação dos eventos de webhook do Evolution API (v2.3.7). Isolado
 * neste arquivo de propósito: se o formato real de algum payload vier
 * diferente do esperado (nomes de campo variam um pouco entre versões
 * menores do Evolution), o ajuste é feito só aqui — a rota em
 * app/api/whatsapp/webhook/route.ts não conhece esses detalhes.
 *
 * Cada handler engole os próprios erros (loga e retorna) em vez de deixar
 * subir — um evento de webhook mal-formado nunca deve derrubar a resposta
 * 200 que o Evolution espera, ou ele fica reenviando o mesmo evento à toa.
 *
 * Logging: todo evento loga o payload bruto (`data`) recebido, e cada ponto
 * de decisão (contato achado/não achado, mensagem duplicada, etc.) — de
 * propósito, pra diagnosticar sem precisar reproduzir o problema às cegas.
 * Procure por "[wa:webhook]" nos logs do container.
 */

import { prisma } from "@/lib/prisma";
import { normalizePhoneNumber } from "@/lib/phone-normalize";
import { getIncomingMediaBase64 } from "@/lib/evolution";
import { assertValidChatMedia, buildChatMediaKey, uploadChatMedia, ChatMediaUploadError } from "@/lib/r2";
import { notifyInstanceDisconnected } from "@/lib/whatsapp/instance-alerts";
import { getOrCreateThread } from "@/lib/whatsapp/threads";
import type { $Enums, Prisma } from "@/app/generated/prisma/client";

type InstanceRef = {
  id: string;
  organizationId: string;
  instanceName: string;
  userId: string;
  status: $Enums.WhatsAppInstanceStatus;
  phoneNumber: string | null;
};

type ContextInfo = { stanzaId?: string };

type BaileysMessage = {
  key?: { remoteJid?: string; fromMe?: boolean; id?: string };
  // Nome de exibição do WhatsApp de quem mandou — irmão de key/message no
  // mesmo nível (confirmado em payload real de produção: {"key":{...},
  // "pushName":"Gabriel Ferreira","message":{...}}).
  pushName?: string;
  message?: {
    conversation?: string;
    extendedTextMessage?: { text?: string; contextInfo?: ContextInfo };
    imageMessage?: { caption?: string; contextInfo?: ContextInfo };
    audioMessage?: Record<string, unknown> & { contextInfo?: ContextInfo };
  };
};

function extractMessages(data: unknown): BaileysMessage[] {
  if (!data || typeof data !== "object") return [];
  // Evolution normalmente manda um objeto de mensagem por chamada de webhook,
  // mas versões que espelham o formato cru do Baileys mandam
  // `{ messages: [...] }` — aceita os dois formatos.
  const asRecord = data as Record<string, unknown>;
  if (Array.isArray(asRecord.messages)) return asRecord.messages as BaileysMessage[];
  if ("key" in asRecord || "message" in asRecord) return [data as BaileysMessage];
  return [];
}

function extractText(msg: BaileysMessage): string | null {
  return msg.message?.conversation ?? msg.message?.extendedTextMessage?.text ?? null;
}

function extractMediaKind(msg: BaileysMessage): "IMAGE" | "AUDIO" | null {
  if (msg.message?.imageMessage) return "IMAGE";
  if (msg.message?.audioMessage) return "AUDIO";
  return null;
}

/** externalId da mensagem citada, quando o lead responde a algo — "stanzaId" é o nome do WhatsApp/Baileys pra isso. */
function extractQuotedExternalId(msg: BaileysMessage): string | undefined {
  return (
    msg.message?.extendedTextMessage?.contextInfo?.stanzaId ??
    msg.message?.imageMessage?.contextInfo?.stanzaId ??
    msg.message?.audioMessage?.contextInfo?.stanzaId
  );
}

export async function handleIncomingMessage(instance: InstanceRef, data: unknown): Promise<void> {
  console.log(`[wa:webhook] messages.upsert instância=${instance.instanceName} payload bruto:`, JSON.stringify(data));

  const messages = extractMessages(data);
  console.log(`[wa:webhook] ${messages.length} mensagem(ns) extraída(s) do payload`);

  for (const msg of messages) {
    try {
      const remoteJid = msg.key?.remoteJid;
      if (!remoteJid) {
        console.log("[wa:webhook] ignorada: sem key.remoteJid", JSON.stringify(msg));
        continue;
      }
      if (remoteJid.endsWith("@g.us")) {
        console.log(`[wa:webhook] ignorada: mensagem de grupo (${remoteJid})`);
        continue;
      }

      const rawNumber = remoteJid.split("@")[0];
      const normalized = normalizePhoneNumber(rawNumber);
      if (!normalized) {
        console.log("[wa:webhook] ignorada: número não normalizável");
        continue;
      }

      // A conversa existe por si só — não exige mais que o número já seja
      // um Contact cadastrado (ver lib/whatsapp/threads.ts). Se bater com
      // um Contact, linka na hora; senão fica em "WhatsApp Geral" até
      // alguém cadastrar esse número.
      const thread = await getOrCreateThread({
        organizationId: instance.organizationId,
        instanceId: instance.id,
        phoneNormalized: normalized,
        whatsappName: msg.pushName,
      });
      console.log(
        `[wa:webhook] remoteJid=${remoteJid} → normalizado=${normalized} → thread=${thread.id} contactId=${thread.contactId ?? "—"} pushName="${msg.pushName ?? "—"}"`,
      );

      const externalId = msg.key?.id;
      if (externalId) {
        const existing = await prisma.whatsAppMessage.findUnique({ where: { externalId }, select: { id: true } });
        if (existing) {
          console.log(`[wa:webhook] ignorada: externalId ${externalId} já registrado (duplicata/eco)`);
          continue;
        }
      }

      let body = extractText(msg);
      let type: $Enums.WhatsAppMessageType = "TEXT";
      let mediaUrl: string | undefined;

      const mediaKind = extractMediaKind(msg);
      if (mediaKind) {
        console.log(`[wa:webhook] mensagem contém mídia (${mediaKind}) — baixando via Evolution...`);
        const media = await getIncomingMediaBase64(instance.instanceName, msg);
        if (!media) {
          console.warn("[wa:webhook] Evolution não retornou a mídia (mensagem pode ter expirado ou já foi removida)");
        } else {
          try {
            const buffer = Buffer.from(media.base64, "base64");
            assertValidChatMedia(media.mimetype, buffer.length);
            const key = buildChatMediaKey(instance.organizationId, media.mimetype);
            await uploadChatMedia(key, buffer, media.mimetype);
            type = mediaKind;
            mediaUrl = key;
            body = media.caption ?? body;
            console.log(
              `[wa:webhook] mídia baixada e salva no R2: key=${key} mimetype=${media.mimetype} tamanho=${buffer.length} bytes`,
            );
          } catch (err) {
            const reason = err instanceof ChatMediaUploadError ? err.message : String(err);
            console.error(`[wa:webhook] falha ao salvar mídia recebida no R2: ${reason}`);
          }
        }
      }

      let replyToId: string | undefined;
      const quotedExternalId = extractQuotedExternalId(msg);
      if (quotedExternalId) {
        const quotedMessage = await prisma.whatsAppMessage.findUnique({
          where: { externalId: quotedExternalId },
          select: { id: true },
        });
        replyToId = quotedMessage?.id;
        console.log(
          `[wa:webhook] mensagem é resposta a externalId=${quotedExternalId} → ${replyToId ? `encontrada (${replyToId})` : "não encontrada no histórico"}`,
        );
      }

      const direction = msg.key?.fromMe ? "OUTBOUND" : "INBOUND";
      const saved = await prisma.whatsAppMessage.create({
        data: {
          organizationId: instance.organizationId,
          instanceId: instance.id,
          threadId: thread.id,
          direction,
          type,
          body,
          mediaUrl,
          externalId: externalId ?? undefined,
          rawPayload: msg.key ? ({ key: msg.key, message: msg.message } as Prisma.InputJsonValue) : undefined,
          replyToId,
          status: "DELIVERED",
        },
      });
      console.log(
        `[wa:webhook] mensagem salva: id=${saved.id} direction=${direction} type=${type} body="${body}" mediaUrl=${mediaUrl ?? "—"}`,
      );
    } catch (err) {
      console.error("[wa:webhook] falha ao processar mensagem recebida", err);
    }
  }
}

const ACK_STATUS_MAP: Record<string, $Enums.WhatsAppMessageStatus> = {
  "0": "FAILED",
  "1": "SENT",
  "2": "SENT",
  "3": "DELIVERED",
  "4": "READ",
  ERROR: "FAILED",
  PENDING: "SENT",
  SERVER_ACK: "SENT",
  DELIVERY_ACK: "DELIVERED",
  READ: "READ",
};

export async function handleStatusUpdate(instance: InstanceRef, data: unknown): Promise<void> {
  console.log(`[wa:webhook] messages.update instância=${instance.instanceName} payload bruto:`, JSON.stringify(data));
  try {
    const update = data as { key?: { id?: string }; keyId?: string; status?: string | number };
    const externalId = update?.key?.id ?? update?.keyId;
    if (!externalId) {
      console.log("[wa:webhook] status ignorado: sem key.id/keyId no payload");
      return;
    }

    const mapped = ACK_STATUS_MAP[String(update.status)];
    if (!mapped) {
      console.log(`[wa:webhook] status ignorado: valor "${update.status}" não mapeado`);
      return;
    }

    const result = await prisma.whatsAppMessage.updateMany({ where: { externalId }, data: { status: mapped } });
    console.log(`[wa:webhook] status "${update.status}" → ${mapped} aplicado a ${result.count} mensagem(ns) (externalId=${externalId})`);
  } catch (err) {
    console.error("[wa:webhook] falha ao processar status de mensagem", err);
  }
}

export async function handleConnectionUpdate(instance: InstanceRef, data: unknown): Promise<void> {
  console.log(`[wa:webhook] connection.update instância=${instance.instanceName} payload bruto:`, JSON.stringify(data));
  try {
    const update = data as { state?: string; wuid?: string };
    const status: $Enums.WhatsAppInstanceStatus =
      update?.state === "open" ? "CONNECTED" : update?.state === "connecting" ? "CONNECTING" : "DISCONNECTED";
    const phoneNumber = update?.wuid ? normalizePhoneNumber(update.wuid.split("@")[0]) : null;

    // Só avisa por e-mail na transição de conectado → desconectado — não a
    // cada evento (o Evolution manda "connecting" várias vezes durante o
    // pareamento normal, isso não pode virar spam de e-mail).
    if (instance.status === "CONNECTED" && status === "DISCONNECTED") {
      notifyInstanceDisconnected(instance).catch((err) =>
        console.error("[wa:webhook] falha ao enviar alerta de desconexão por e-mail", err),
      );
    }

    // disconnectedAt marca o início da "queda atual" (pro cron de saúde saber
    // quando escalar pra 1/2/3 dias); reconectar zera tudo, começa do zero
    // na próxima queda.
    const escalationFields =
      status === "CONNECTED"
        ? { disconnectedAt: null, disconnectAlertLevel: 0 }
        : status === "DISCONNECTED" && instance.status !== "DISCONNECTED"
          ? { disconnectedAt: new Date(), disconnectAlertLevel: 0 }
          : {};

    await prisma.whatsAppInstance.update({
      where: { id: instance.id },
      data: { status, ...(phoneNumber ? { phoneNumber } : {}), ...escalationFields },
    });
    console.log(`[wa:webhook] instância ${instance.instanceName} → status=${status} phoneNumber=${phoneNumber}`);
  } catch (err) {
    console.error("[wa:webhook] falha ao processar atualização de conexão", err);
  }
}
