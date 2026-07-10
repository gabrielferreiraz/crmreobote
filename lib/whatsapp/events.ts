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
import type { $Enums } from "@/app/generated/prisma/client";

type InstanceRef = { id: string; organizationId: string; instanceName: string };

type BaileysMessage = {
  key?: { remoteJid?: string; fromMe?: boolean; id?: string };
  message?: { conversation?: string; extendedTextMessage?: { text?: string } };
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
      console.log(`[wa:webhook] remoteJid=${remoteJid} → número bruto=${rawNumber} → normalizado=${normalized}`);
      if (!normalized) {
        console.log("[wa:webhook] ignorada: número não normalizável");
        continue;
      }

      const contact = await prisma.contact.findFirst({
        where: {
          organizationId: instance.organizationId,
          OR: [{ whatsappNormalized: normalized }, { phoneNormalized: normalized }],
        },
        select: { id: true, name: true },
      });
      // Não cria contato novo a partir de mensagem recebida — só reflete
      // conversa em contatos que já existem no CRM.
      if (!contact) {
        console.log(
          `[wa:webhook] ignorada: nenhum contato com número normalizado "${normalized}" nesta organização`,
        );
        continue;
      }
      console.log(`[wa:webhook] contato encontrado: ${contact.name} (${contact.id})`);

      const externalId = msg.key?.id;
      if (externalId) {
        const existing = await prisma.whatsAppMessage.findUnique({ where: { externalId }, select: { id: true } });
        if (existing) {
          console.log(`[wa:webhook] ignorada: externalId ${externalId} já registrado (duplicata/eco)`);
          continue;
        }
      }

      const body = extractText(msg);
      const direction = msg.key?.fromMe ? "OUTBOUND" : "INBOUND";
      const saved = await prisma.whatsAppMessage.create({
        data: {
          organizationId: instance.organizationId,
          instanceId: instance.id,
          contactId: contact.id,
          direction,
          body,
          externalId: externalId ?? undefined,
          status: "DELIVERED",
        },
      });
      console.log(`[wa:webhook] mensagem salva: id=${saved.id} direction=${direction} body="${body}"`);
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

    await prisma.whatsAppInstance.update({
      where: { id: instance.id },
      data: { status, ...(phoneNumber ? { phoneNumber } : {}) },
    });
    console.log(`[wa:webhook] instância ${instance.instanceName} → status=${status} phoneNumber=${phoneNumber}`);
  } catch (err) {
    console.error("[wa:webhook] falha ao processar atualização de conexão", err);
  }
}
