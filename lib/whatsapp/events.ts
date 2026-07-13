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
import { normalizePhoneNumber, formatBrazilianPhone } from "@/lib/phone-normalize";
import { getIncomingMediaBase64 } from "@/lib/evolution";
import { assertValidChatMedia, buildChatMediaKey, uploadChatMedia, ChatMediaUploadError } from "@/lib/r2";
import { notifyInstanceConnected, notifyInstanceDisconnected } from "@/lib/whatsapp/instance-alerts";
import { getOrCreateThread } from "@/lib/whatsapp/threads";
import { sendPushToUser } from "@/lib/push";
import { handleCampaignReply } from "@/lib/campaigns/reply";
import type { $Enums, Prisma } from "@/app/generated/prisma/client";

type InstanceRef = {
  id: string;
  organizationId: string;
  instanceName: string;
  userId: string;
  status: $Enums.WhatsAppInstanceStatus;
  phoneNumber: string | null;
  notifyOnCrmMessage: boolean;
  notifyOnGeralMessage: boolean;
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
    stickerMessage?: Record<string, unknown> & { contextInfo?: ContextInfo };
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

function extractMediaKind(msg: BaileysMessage): "IMAGE" | "AUDIO" | "STICKER" | null {
  if (msg.message?.imageMessage) return "IMAGE";
  if (msg.message?.audioMessage) return "AUDIO";
  if (msg.message?.stickerMessage) return "STICKER";
  return null;
}

/** externalId da mensagem citada, quando o lead responde a algo — "stanzaId" é o nome do WhatsApp/Baileys pra isso. */
function extractQuotedExternalId(msg: BaileysMessage): string | undefined {
  return (
    msg.message?.extendedTextMessage?.contextInfo?.stanzaId ??
    msg.message?.imageMessage?.contextInfo?.stanzaId ??
    msg.message?.audioMessage?.contextInfo?.stanzaId ??
    msg.message?.stickerMessage?.contextInfo?.stanzaId
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

      // pushName é o nome de quem MANDOU essa mensagem específica — numa
      // mensagem OUTBOUND (eco do que o próprio vendedor mandou, inclusive
      // pelo celular dele direto), isso é o nome do próprio vendedor, não
      // do lead do outro lado. Só usa pushName pra nomear a conversa quando
      // for de fato o lead falando (INBOUND); senão a conversa fica com o
      // nome do vendedor até o lead responder alguma vez.
      const direction = msg.key?.fromMe ? "OUTBOUND" : "INBOUND";

      // A conversa existe por si só — não exige mais que o número já seja
      // um Contact cadastrado (ver lib/whatsapp/threads.ts). Se bater com
      // um Contact, linka na hora; senão fica em "WhatsApp Geral" até
      // alguém cadastrar esse número.
      const thread = await getOrCreateThread({
        organizationId: instance.organizationId,
        instanceId: instance.id,
        phoneNormalized: normalized,
        whatsappName: direction === "INBOUND" ? msg.pushName : undefined,
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

      // Push só faz sentido pra mensagem recebida de verdade (nunca pro eco
      // do que o próprio vendedor mandou) — e respeita a preferência de
      // CRM/Geral configurada em Conversas (thread.contactId distingue as duas).
      if (direction === "INBOUND") {
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
            console.error("[wa:webhook] falha ao enviar push de mensagem recebida", err),
          );
        }

        handleCampaignReply(instance.organizationId, thread.id, thread.contactId).catch((err) =>
          console.error("[wa:webhook] falha ao processar resposta de campanha", err),
        );
      }
    } catch (err) {
      console.error("[wa:webhook] falha ao processar mensagem recebida", err);
    }
  }
}

type BaileysCall = {
  id?: string;
  from?: string;
  status?: string;
  isVideo?: boolean;
};

function extractCalls(data: unknown): BaileysCall[] {
  if (!data || typeof data !== "object") return [];
  const asRecord = data as Record<string, unknown>;
  if (Array.isArray(asRecord.calls)) return asRecord.calls as BaileysCall[];
  if (Array.isArray(data)) return data as BaileysCall[];
  if ("id" in asRecord || "from" in asRecord || "status" in asRecord) return [data as BaileysCall];
  return [];
}

// Nomes de status variam entre versões do Baileys/Evolution — "offer" é a
// chamada tocando, "timeout" é quando ninguém atende (a maioria dos casos
// aqui, já que este número não tem alguém de prontidão pra atender chamada de
// voz de verdade). Qualquer status não mapeado cai em MISSED — melhor avisar
// à toa do que deixar uma chamada perdida passar batido.
const CALL_STATUS_MAP: Record<string, "RINGING" | "MISSED" | "REJECTED" | "ACCEPTED"> = {
  offer: "RINGING",
  ringing: "RINGING",
  timeout: "MISSED",
  reject: "REJECTED",
  decline: "REJECTED",
  accept: "ACCEPTED",
};

/**
 * Evento "call" do Evolution/Baileys — chamada de voz/vídeo recebida no
 * número conectado. Como o mesmo id de chamada reaparece a cada mudança de
 * status (tocando → perdida/recusada/atendida), usa upsert por externalId em
 * vez de criar uma linha por status: a conversa mostra só o desfecho final,
 * não um histórico de "tocando" seguido de "perdida" como se fossem duas
 * coisas.
 */
export async function handleIncomingCall(instance: InstanceRef, data: unknown): Promise<void> {
  console.log(`[wa:webhook] call instância=${instance.instanceName} payload bruto:`, JSON.stringify(data));

  const calls = extractCalls(data);
  console.log(`[wa:webhook] ${calls.length} chamada(s) extraída(s) do payload`);

  for (const call of calls) {
    try {
      const remoteJid = call.from;
      if (!remoteJid) {
        console.log("[wa:webhook] chamada ignorada: sem campo 'from'", JSON.stringify(call));
        continue;
      }
      if (remoteJid.endsWith("@g.us")) {
        console.log(`[wa:webhook] chamada ignorada: chamada de grupo (${remoteJid})`);
        continue;
      }

      const rawNumber = remoteJid.split("@")[0];
      const normalized = normalizePhoneNumber(rawNumber);
      if (!normalized) {
        console.log("[wa:webhook] chamada ignorada: número não normalizável");
        continue;
      }

      const callStatus = CALL_STATUS_MAP[String(call.status).toLowerCase()] ?? "MISSED";
      // Prefixo "call:" porque o id de chamada do Baileys pode colidir em
      // teoria com um id de mensagem — mantém os dois espaços de id separados
      // dentro da mesma coluna externalId (única pra toda a tabela).
      const externalId = call.id ? `call:${call.id}` : undefined;
      const label = call.isVideo ? "Chamada de vídeo" : "Chamada de voz";
      const body =
        callStatus === "MISSED"
          ? `📞 ${label} perdida`
          : callStatus === "REJECTED"
            ? `📞 ${label} recusada`
            : callStatus === "ACCEPTED"
              ? `📞 ${label} atendida`
              : `📞 ${label} em andamento`;
      const metadata = { callStatus, isVideo: !!call.isVideo } as Prisma.InputJsonValue;

      const thread = await getOrCreateThread({
        organizationId: instance.organizationId,
        instanceId: instance.id,
        phoneNormalized: normalized,
      });

      const saved = externalId
        ? await prisma.whatsAppMessage.upsert({
            where: { externalId },
            create: {
              organizationId: instance.organizationId,
              instanceId: instance.id,
              threadId: thread.id,
              direction: "INBOUND",
              type: "CALL",
              body,
              metadata,
              externalId,
              status: "DELIVERED",
            },
            update: { body, metadata },
          })
        : await prisma.whatsAppMessage.create({
            data: {
              organizationId: instance.organizationId,
              instanceId: instance.id,
              threadId: thread.id,
              direction: "INBOUND",
              type: "CALL",
              body,
              metadata,
              status: "DELIVERED",
            },
          });
      console.log(`[wa:webhook] chamada salva: id=${saved.id} status=${callStatus} thread=${thread.id}`);

      // Chamada perdida/recusada é pelo menos tão urgente quanto mensagem de
      // texto — avisa por push do mesmo jeito, respeitando a mesma preferência
      // CRM/Geral configurada em Conversas.
      if (callStatus === "MISSED" || callStatus === "REJECTED") {
        const shouldNotify = thread.contactId ? instance.notifyOnCrmMessage : instance.notifyOnGeralMessage;
        if (shouldNotify) {
          let displayName = thread.whatsappName ?? formatBrazilianPhone(normalized) ?? normalized;
          if (thread.contactId) {
            const contact = await prisma.contact.findUnique({
              where: { id: thread.contactId },
              select: { name: true },
            });
            if (contact) displayName = contact.name;
          }
          sendPushToUser(instance.userId, { title: displayName, body, url: "/whatsapp/conversas" }).catch((err) =>
            console.error("[wa:webhook] falha ao enviar push de chamada perdida", err),
          );
        }
      }
    } catch (err) {
      console.error("[wa:webhook] falha ao processar chamada", err);
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

    // Só avisa por e-mail nas transições de verdade (conectado → desconectado
    // e o inverso) — não a cada evento. Importante: o "conectou" só dispara
    // vindo de um DISCONNECTED confirmado, nunca de CONNECTING — o Evolution
    // manda "connecting" à toa em vários momentos (refresh interno de sessão,
    // keep-alive) mesmo com a sessão perfeitamente estável, e isso nunca gera
    // o e-mail de "desconectou" (só DISCONNECTED gera). Se o "conectou"
    // disparasse a partir de "não está CONNECTED" (o que inclui CONNECTING),
    // cada um desses soluços sem desconexão de verdade virava um e-mail de
    // "conectou" — era exatamente esse o e-mail repetido que a gente via.
    if (instance.status === "CONNECTED" && status === "DISCONNECTED") {
      notifyInstanceDisconnected(instance).catch((err) =>
        console.error("[wa:webhook] falha ao enviar alerta de desconexão por e-mail", err),
      );
    } else if (instance.status === "DISCONNECTED" && status === "CONNECTED") {
      notifyInstanceConnected(instance).catch((err) =>
        console.error("[wa:webhook] falha ao enviar alerta de conexão por e-mail", err),
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
