import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithMetaPageLookup, runWithTenant } from "@/lib/tenant-context";
import { secureEqual } from "@/lib/security/secure-compare";
import { verifyMetaWebhookSignature } from "@/lib/meta-graph";
import { decryptSecret } from "@/lib/security/secret-crypto";
import { processLeadgenEvent } from "@/lib/meta-ads/leads";

export const dynamic = "force-dynamic";

type LeadgenWebhookPayload = {
  object?: string;
  entry?: {
    id?: string;
    changes?: {
      field?: string;
      value?: { leadgen_id?: string; page_id?: string };
    }[];
  }[];
};

/**
 * Handshake exigido pela Meta — chamado quando o webhook é configurado no
 * painel do App (produto Webhooks → Página, campo "leadgen"), nunca pelo
 * fluxo normal de leads. Mesmo protocolo do webhook do WhatsApp Cloud API
 * (ver app/api/whatsapp/webhook/meta/route.ts), verify_token PRÓPRIO
 * (META_LEAD_ADS_VERIFY_TOKEN) porque é uma assinatura de webhook separada
 * da do WhatsApp no painel da Meta.
 */
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");

  const expected = process.env.META_LEAD_ADS_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && token && challenge && secureEqual(token, expected)) {
    return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  console.warn("[meta-ads:webhook] handshake rejeitado — hub.mode/hub.verify_token não confere");
  return NextResponse.json({ error: "Verificação falhou" }, { status: 403 });
}

export async function POST(req: NextRequest) {
  // Corpo CRU (não .json() direto) — a assinatura é calculada sobre os bytes
  // exatos que a Meta mandou (mesma nota do webhook do WhatsApp).
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    console.warn("[meta-ads:webhook] requisição rejeitada: X-Hub-Signature-256 ausente/incorreta");
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = JSON.parse(rawBody) as LeadgenWebhookPayload;
  console.log(`[meta-ads:webhook] recebido: object="${body.object}" entradas=${body.entry?.length ?? 0}`);

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "leadgen") continue;

      const leadgenId = change.value?.leadgen_id;
      const pageId = change.value?.page_id ?? entry.id;
      if (!leadgenId || !pageId) {
        console.warn("[meta-ads:webhook] change de leadgen ignorado: sem leadgen_id/page_id", JSON.stringify(change));
        continue;
      }

      try {
        const connection = await runWithMetaPageLookup(pageId, () =>
          prisma.metaAdsConnection.findUnique({ where: { pageId } }),
        );
        if (!connection) {
          console.warn(`[meta-ads:webhook] ignorado: nenhuma MetaAdsConnection com pageId="${pageId}"`);
          continue;
        }

        await runWithTenant(connection.organizationId, async () => {
          const pageAccessToken = decryptSecret(connection.pageAccessTokenEncrypted);
          await processLeadgenEvent(connection.organizationId, leadgenId, pageAccessToken);
        });
      } catch (err) {
        // Um lead mal-processado nunca pode derrubar a resposta 200 —
        // senão a Meta fica reenviando o mesmo evento à toa (mesma regra do
        // webhook do Evolution/WhatsApp).
        console.error(`[meta-ads:webhook] falha ao processar leadgen_id=${leadgenId}`, err);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
