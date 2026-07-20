import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithInstanceLookup, runWithTenant } from "@/lib/tenant-context";
import { secureEqual } from "@/lib/security/secure-compare";
import { verifyWebhookSignature } from "@/lib/meta-whatsapp";
import { handleMetaMessages, handleMetaStatuses, type MetaMessage, type MetaStatus, type MetaContact } from "@/lib/whatsapp/meta-events";

export const dynamic = "force-dynamic";

type MetaWebhookPayload = {
  object?: string;
  entry?: {
    id?: string;
    changes?: {
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: MetaContact[];
        messages?: MetaMessage[];
        statuses?: MetaStatus[];
      };
      field?: string;
    }[];
  }[];
};

/**
 * Handshake exigido pela Meta — chamado UMA VEZ quando o webhook é
 * configurado no painel do App (Produto WhatsApp → Configuration), nunca
 * pelo fluxo normal de mensagens. Protocolo bem diferente do Evolution (que
 * usa um segredo por query string direto no POST): aqui é um GET com três
 * parâmetros, e a resposta precisa ser o `hub.challenge` cru (texto puro,
 * não JSON) — qualquer outra coisa e a Meta recusa salvar a URL.
 */
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");

  const expected = process.env.META_WHATSAPP_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && token && challenge && secureEqual(token, expected)) {
    return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  console.warn("[wa:meta-webhook] handshake rejeitado — hub.mode/hub.verify_token não confere");
  return NextResponse.json({ error: "Verificação falhou" }, { status: 403 });
}

export async function POST(req: NextRequest) {
  // Corpo CRU (não .json() direto) — a assinatura é calculada sobre os bytes
  // exatos que a Meta mandou; reserializar o JSON parseado poderia produzir
  // uma string byte-a-byte diferente (espaços, ordem de chaves) e invalidar
  // a verificação mesmo com um payload legítimo.
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  if (!verifyWebhookSignature(rawBody, signature)) {
    console.warn("[wa:meta-webhook] requisição rejeitada: X-Hub-Signature-256 ausente/incorreta");
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = JSON.parse(rawBody) as MetaWebhookPayload;
  console.log(`[wa:meta-webhook] recebido: object="${body.object}" entradas=${body.entry?.length ?? 0}`);

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) {
        console.warn("[wa:meta-webhook] change ignorado: sem metadata.phone_number_id", JSON.stringify(change));
        continue;
      }

      // Mesmo mecanismo de bootstrap de tenant do webhook do Evolution (ver
      // lib/tenant-context.ts) — a linha META_CLOUD recebe um instanceName
      // sintético só pra isso, evitando duplicar a policy de RLS de
      // bootstrap (ver migração 20260710153000_whatsapp_instance_bootstrap_policy).
      const syntheticInstanceName = `meta-${phoneNumberId}`;
      const instance = await runWithInstanceLookup(syntheticInstanceName, () =>
        prisma.whatsAppInstance.findUnique({ where: { instanceName: syntheticInstanceName } }),
      );
      if (!instance) {
        console.warn(`[wa:meta-webhook] ignorado: nenhuma WhatsAppInstance com phone_number_id="${phoneNumberId}"`);
        continue;
      }

      await runWithTenant(instance.organizationId, async () => {
        if (value?.messages?.length) {
          await handleMetaMessages(instance, value.messages, value.contacts ?? []);
        }
        if (value?.statuses?.length) {
          await handleMetaStatuses(instance.organizationId, value.statuses);
        }
      });
    }
  }

  return NextResponse.json({ ok: true });
}
