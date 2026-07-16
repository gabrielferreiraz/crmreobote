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
import { normalizePhoneNumber, formatBrazilianPhone, extractJidUser } from "@/lib/phone-normalize";
import { getIncomingMediaBase64, findMessages, type HistoryMessage } from "@/lib/evolution";
import { assertValidChatMedia, buildChatMediaKey, uploadChatMedia, ChatMediaUploadError } from "@/lib/r2";
import { notifyInstanceConnected, notifyInstanceDisconnected } from "@/lib/whatsapp/instance-alerts";
import { isActiveMember, deleteInstanceForInactiveUser } from "@/lib/whatsapp/instance-cleanup";
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
  historySyncedAt: Date | null;
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

type SaveMessageOptions = {
  /** false pro backfill de histórico — nunca manda push nem processa resposta de campanha por uma mensagem antiga. */
  notify: boolean;
  /** Preserva o horário real da mensagem no backfill; tempo real usa o default (now()) do banco. */
  createdAt?: Date;
};

/**
 * Processa e grava UMA mensagem (recebida em tempo real via webhook, ou
 * histórica via backfill — ver importHistoryMessages) — mesma lógica pros
 * dois casos: resolve/cria a conversa, baixa mídia, resolve resposta citada,
 * deduplica por externalId. O que muda é só `options` (notificar ou não, e
 * qual `createdAt` usar).
 */
async function saveIncomingMessage(instance: InstanceRef, msg: BaileysMessage, options: SaveMessageOptions): Promise<void> {
  const remoteJid = msg.key?.remoteJid;
  if (!remoteJid) {
    console.log("[wa:webhook] ignorada: sem key.remoteJid", JSON.stringify(msg));
    return;
  }
  if (remoteJid.endsWith("@g.us")) {
    console.log(`[wa:webhook] ignorada: mensagem de grupo (${remoteJid})`);
    return;
  }

  const rawNumber = extractJidUser(remoteJid);
  const normalized = normalizePhoneNumber(rawNumber);
  if (!normalized) {
    console.log("[wa:webhook] ignorada: número não normalizável");
    return;
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
      return;
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
        assertValidChatMedia(media.mimetype, buffer.length, buffer);
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
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    },
  });
  console.log(
    `[wa:webhook] mensagem salva: id=${saved.id} direction=${direction} type=${type} body="${body}" mediaUrl=${mediaUrl ?? "—"}`,
  );

  // Push e resposta de campanha só fazem sentido pra mensagem recebida de
  // verdade em tempo real (nunca pro eco do que o próprio vendedor mandou,
  // nem pra uma mensagem antiga vinda do backfill de histórico).
  if (direction === "INBOUND" && options.notify) {
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
}

export async function handleIncomingMessage(instance: InstanceRef, data: unknown): Promise<void> {
  console.log(`[wa:webhook] messages.upsert instância=${instance.instanceName} payload bruto:`, JSON.stringify(data));

  const messages = extractMessages(data);
  console.log(`[wa:webhook] ${messages.length} mensagem(ns) extraída(s) do payload`);

  for (const msg of messages) {
    try {
      await saveIncomingMessage(instance, msg, { notify: true });
    } catch (err) {
      console.error("[wa:webhook] falha ao processar mensagem recebida", err);
    }
  }
}

const HISTORY_MESSAGES_PER_CONTACT = 1000;

/** Epoch do Baileys pode vir em segundos ou já em ms conforme a versão — abaixo de 10 bilhões só pode ser segundos (ms nessa faixa seria ano 1970). */
function toEpochMs(ts: number | string | undefined): number {
  if (ts === undefined) return Date.now();
  const n = typeof ts === "string" ? Number(ts) : ts;
  if (!Number.isFinite(n)) return Date.now();
  return n < 10_000_000_000 ? n * 1000 : n;
}

/**
 * Importa o histórico de conversas já sincronizado pelo Evolution (ver
 * `syncFullHistory` em lib/evolution.ts) — busca tudo de uma vez, agrupa por
 * contato e mantém só as `HISTORY_MESSAGES_PER_CONTACT` mais recentes de
 * cada um, preservando o horário real de cada mensagem (`createdAt`
 * explícito) pra a conversa aparecer na ordem certa.
 */
export async function importHistoryMessages(instance: InstanceRef): Promise<{ imported: number; contacts: number }> {
  let raw: HistoryMessage[];
  try {
    raw = await findMessages(instance.instanceName);
  } catch (err) {
    console.error(`[wa:webhook] falha ao buscar histórico de ${instance.instanceName}`, err);
    return { imported: 0, contacts: 0 };
  }
  console.log(`[wa:webhook] histórico bruto de ${instance.instanceName}: ${raw.length} mensagem(ns)`);

  const byContact = new Map<string, HistoryMessage[]>();
  for (const item of raw) {
    const remoteJid = item.key?.remoteJid;
    if (!remoteJid || remoteJid.endsWith("@g.us")) continue;
    const list = byContact.get(remoteJid) ?? [];
    list.push(item);
    byContact.set(remoteJid, list);
  }

  let imported = 0;
  for (const items of byContact.values()) {
    const mostRecentFirst = [...items].sort((a, b) => toEpochMs(b.messageTimestamp) - toEpochMs(a.messageTimestamp));
    const chronological = mostRecentFirst.slice(0, HISTORY_MESSAGES_PER_CONTACT).reverse();

    for (const item of chronological) {
      try {
        await saveIncomingMessage(instance, item as BaileysMessage, {
          notify: false,
          createdAt: new Date(toEpochMs(item.messageTimestamp)),
        });
        imported += 1;
      } catch (err) {
        console.error("[wa:webhook] falha ao importar mensagem histórica", err);
      }
    }
  }

  console.log(`[wa:webhook] histórico importado de ${instance.instanceName}: ${imported} mensagem(ns) em ${byContact.size} conversa(s)`);
  return { imported, contacts: byContact.size };
}

/**
 * Gatilho do evento MESSAGES_SET — roda a importação uma única vez por
 * pareamento (marca `historySyncedAt`), mesmo que o Evolution reenvie esse
 * evento mais de uma vez (acontece em sync grande, mandado em pedaços).
 *
 * Só marca `historySyncedAt` se de fato importou alguma mensagem — o
 * WhatsApp decide quanto histórico manda nesse momento (às vezes nada, ou
 * o Evolution ainda não tinha terminado de receber quando esse evento
 * chegou); marcar como "concluído" numa tentativa que trouxe zero mensagens
 * deixaria a importação pra sempre incompleta, sem nenhuma chance de tentar
 * de novo num evento seguinte. Também dá pra puxar manualmente depois (ver
 * app/api/whatsapp/instance/import-history/route.ts) pra quem já conectou.
 */
export async function handleHistorySync(instance: InstanceRef): Promise<void> {
  if (instance.historySyncedAt) {
    console.log(`[wa:webhook] histórico de ${instance.instanceName} já importado antes (${instance.historySyncedAt.toISOString()}) — ignorando`);
    return;
  }

  const result = await importHistoryMessages(instance);
  if (result.imported > 0) {
    await prisma.whatsAppInstance.update({ where: { id: instance.id }, data: { historySyncedAt: new Date() } });
  } else {
    console.log(`[wa:webhook] histórico de ${instance.instanceName}: 0 mensagem(ns) nesta tentativa — não marca como concluído`);
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

      const rawNumber = extractJidUser(remoteJid);
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

const VALID_PRESENCE_STATUSES = new Set(["available", "unavailable", "composing", "recording", "paused"]);

/**
 * Presença (online/digitando/gravando áudio) — só chega depois que a gente
 * se inscreve nesse número (ver lib/evolution.ts's sendPresence, chamado
 * por app/api/whatsapp/messages/[threadId]/route.ts enquanto o chat está
 * aberto). Payload cru do Baileys: `{ id: remoteJid, presences: { [jid]:
 * { lastKnownPresence, lastSeen? } } }` — numa conversa 1:1 só tem 1
 * participante mesmo, então pega a 1ª entrada sem procurar pelo jid exato.
 */
export async function handlePresenceUpdate(instance: InstanceRef, data: unknown): Promise<void> {
  try {
    const update = data as { id?: string; presences?: Record<string, { lastKnownPresence?: string; lastSeen?: number }> };
    const remoteJid = update?.id;
    if (!remoteJid || remoteJid.endsWith("@g.us")) return; // presença de grupo não nos interessa

    const rawNumber = extractJidUser(remoteJid);
    const phoneNormalized = normalizePhoneNumber(rawNumber);
    if (!phoneNormalized) return;

    const presenceInfo = Object.values(update.presences ?? {})[0];
    if (!presenceInfo?.lastKnownPresence || !VALID_PRESENCE_STATUSES.has(presenceInfo.lastKnownPresence)) return;

    const thread = await prisma.whatsAppThread.findUnique({
      where: { instanceId_phoneNormalized: { instanceId: instance.id, phoneNormalized } },
    });
    if (!thread) return; // presença de alguém que nunca trocou mensagem com a gente — nada pra atualizar

    await prisma.whatsAppThread.update({
      where: { id: thread.id },
      data: {
        presenceStatus: presenceInfo.lastKnownPresence,
        presenceUpdatedAt: new Date(),
        ...(presenceInfo.lastSeen ? { lastSeenAt: new Date(presenceInfo.lastSeen * 1000) } : {}),
      },
    });
  } catch (err) {
    console.error("[wa:webhook] falha ao processar presence.update", err);
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
    const phoneNumber = update?.wuid ? normalizePhoneNumber(extractJidUser(update.wuid)) : null;

    // Dono não é mais membro ativo da organização — em vez de só marcar
    // desconectado e ficar esperando alguém reconectar (o que nunca vai
    // acontecer), remove a instância de vez. Nunca faz isso pra quem
    // continua ativo, mesmo desconectado.
    if (status === "DISCONNECTED" && !(await isActiveMember(instance.organizationId, instance.userId))) {
      await deleteInstanceForInactiveUser(instance);
      console.log(`[wa:webhook] instância ${instance.instanceName} removida — dono não é mais membro ativo`);
      return;
    }

    // Primeiro pareamento de verdade (nunca teve phoneNumber gravado ainda) —
    // o estado anterior aqui é "CONNECTING" (setado na criação da instância,
    // nunca "DISCONNECTED"), então sem esse caso o e-mail de boas-vindas
    // nunca disparava pra quem tava conectando um WhatsApp pela 1ª vez.
    const isFirstEverConnection = !instance.phoneNumber;

    // Só avisa por e-mail nas transições de verdade (conectado → desconectado
    // e o inverso) — não a cada evento. Importante: o "conectou" só dispara
    // vindo de um DISCONNECTED confirmado (ou do 1º pareamento), nunca de um
    // CONNECTING qualquer — o Evolution manda "connecting" à toa em vários
    // momentos (refresh interno de sessão, keep-alive) mesmo com a sessão já
    // estável antes, e isso nunca gera o e-mail de "desconectou" (só
    // DISCONNECTED gera). Se o "conectou" disparasse a partir de "não está
    // CONNECTED" (o que inclui CONNECTING), cada um desses soluços sem
    // desconexão de verdade virava um e-mail de "conectou" — era exatamente
    // esse o e-mail repetido que a gente via.
    if (instance.status === "CONNECTED" && status === "DISCONNECTED") {
      notifyInstanceDisconnected(instance).catch((err) =>
        console.error("[wa:webhook] falha ao enviar alerta de desconexão por e-mail", err),
      );
    } else if (status === "CONNECTED" && instance.status !== "CONNECTED" && (instance.status === "DISCONNECTED" || isFirstEverConnection)) {
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

    // Nunca grava "CONNECTING" por cima de um CONNECTED/DISCONNECTED real —
    // o Evolution manda esse estado à toa em vários momentos (comentário
    // acima) mesmo com a sessão estável, e persistir isso apagava o status
    // anterior de verdade que a detecção de transição (bloco acima) e o
    // cron de saúde (lib/whatsapp/health-check.ts) dependem pra comparar no
    // próximo evento — sem essa proteção, um blip desses podia silenciar o
    // próximo e-mail de conectou/desconectou sem erro nenhum no log, e
    // deixar a instância invisível pras duas rotinas do health-check (que só
    // olham status CONNECTED ou DISCONNECTED). O "CONNECTING" inicial (na
    // criação da instância) não passa por aqui, continua gravado normalmente.
    const shouldPersistStatus = status !== "CONNECTING";

    await prisma.whatsAppInstance.update({
      where: { id: instance.id },
      data: {
        ...(shouldPersistStatus ? { status } : {}),
        ...(phoneNumber ? { phoneNumber } : {}),
        ...escalationFields,
      },
    });
    console.log(
      `[wa:webhook] instância ${instance.instanceName} → status=${status}${shouldPersistStatus ? "" : " (não persistido — blip passageiro)"} phoneNumber=${phoneNumber}`,
    );
  } catch (err) {
    console.error("[wa:webhook] falha ao processar atualização de conexão", err);
  }
}
