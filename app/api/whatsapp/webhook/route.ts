import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithInstanceLookup, runWithTenant } from "@/lib/tenant-context";
import { secureEqual } from "@/lib/security/secure-compare";
import { readJson, BodyTooLargeError } from "@/lib/read-body";
import {
  handleIncomingMessage,
  handleStatusUpdate,
  handleConnectionUpdate,
  handleIncomingCall,
  handleHistorySync,
  handlePresenceUpdate,
} from "@/lib/whatsapp/events";

const EVOLUTION_WEBHOOK_MAX_BYTES = 25 * 1024 * 1024;

export const dynamic = "force-dynamic";

// Chamado pelo Evolution API, não por um usuário logado — a autenticação é o
// segredo compartilhado na própria URL (ver buildWebhookUrl em
// app/api/whatsapp/instance/route.ts), não uma sessão. Comparação em tempo
// constante (secureEqual) — `===` normal permite (em teoria) inferir o
// segredo caractere a caractere medindo o tempo de resposta.
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET;
  const provided = req.nextUrl.searchParams.get("secret");
  return !!secret && !!provided && secureEqual(provided, secret);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    console.warn("[wa:webhook] requisição rejeitada: segredo ausente/incorreto na URL");
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  // Teto de 25 MB (não o de 2 MB dos outros webhooks): o evento de histórico
  // (MESSAGES_SET) traz muitas mensagens de uma vez. Mídia não vem embutida
  // (base64: false, ver lib/evolution.ts). A rota já exige o segredo; o teto
  // só impede um corpo gigante de derrubar a memória do servidor.
  let body: Record<string, unknown> | null = null;
  try {
    body = await readJson<Record<string, unknown>>(req, EVOLUTION_WEBHOOK_MAX_BYTES);
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      console.error(`[wa:webhook] corpo acima de ${EVOLUTION_WEBHOOK_MAX_BYTES} bytes — ignorado`);
      return NextResponse.json({ ok: true });
    }
    console.error("[wa:webhook] corpo da requisição não é JSON válido", err instanceof Error ? err.message : err);
    body = null;
  }
  const instanceName = body?.instance as string | undefined;
  const event = (body?.event as string | undefined)?.toLowerCase();
  const data = body?.data;

  console.log(`[wa:webhook] recebido: instance="${instanceName}" event="${event}"`);

  // Payload que não reconhecemos: responde 200 mesmo assim, senão o Evolution
  // fica reenviando o mesmo evento indefinidamente.
  if (!instanceName || !event) {
    // Só as CHAVES do payload — o corpo traz telefone e conteúdo de mensagem.
    console.warn("[wa:webhook] ignorado: instance ou event ausente no payload; chaves:", Object.keys((body as object) ?? {}).join(","));
    return NextResponse.json({ ok: true });
  }

  const instance = await runWithInstanceLookup(instanceName, () =>
    prisma.whatsAppInstance.findUnique({ where: { instanceName } }),
  );
  if (!instance) {
    console.warn(`[wa:webhook] ignorado: nenhuma WhatsAppInstance com instanceName="${instanceName}"`);
    return NextResponse.json({ ok: true });
  }

  return runWithTenant(instance.organizationId, async () => {
    if (event === "messages.upsert") {
      await handleIncomingMessage(instance, data);
    } else if (event === "messages.update") {
      await handleStatusUpdate(instance, data);
    } else if (event === "connection.update") {
      await handleConnectionUpdate(instance, data);
    } else if (event === "call") {
      await handleIncomingCall(instance, data);
    } else if (event === "messages.set") {
      // Ignora o payload deste evento de propósito — chama o endpoint de
      // histórico direto (ver lib/whatsapp/events.ts) em vez de confiar no
      // formato deste payload, que pode vir em pedaços num sync grande.
      await handleHistorySync(instance);
    } else if (event === "presence.update") {
      await handlePresenceUpdate(instance, data);
    } else {
      console.log(`[wa:webhook] evento "${event}" recebido mas não tratado (nenhum handler pra ele ainda)`);
    }
    return NextResponse.json({ ok: true });
  });
}
