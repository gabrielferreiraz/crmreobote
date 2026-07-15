import { NextResponse } from "next/server";
import { getChatMediaObject } from "@/lib/r2";
import { verifyMediaToken } from "@/lib/whatsapp/media-token";

export const dynamic = "force-dynamic";

/**
 * Chamado pelo Evolution API, nunca pelo navegador — é de onde ele baixa a
 * mídia pra reenviar/converter pro WhatsApp (ver buildEvolutionMediaUrl em
 * lib/whatsapp/send.ts). Existe em vez de uma URL assinada do R2 porque o
 * Evolution acrescenta um "?timestamp=" na URL antes de baixar, o que
 * invalida a assinatura de uma URL de query-string (o R2 responde 403).
 *
 * Primeiro segmento do path é o token assinado (HMAC + validade de 1h) —
 * sem ele, a única proteção era a chave em si nunca vazar, o que não
 * expira nem valida organização nenhuma.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key: allParts } = await params;
  const [token, ...keyParts] = allParts;
  const key = keyParts.join("/");

  // Só serve chaves deste namespace — nunca vira um proxy aberto pro resto do bucket (avatares, etc).
  if (!key.startsWith("whatsapp-media/")) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  }

  if (!verifyMediaToken(key, token)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const object = await getChatMediaObject(key);
  if (!object) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

  return new NextResponse(new Blob([object.body.slice()]), { headers: { "Content-Type": object.contentType } });
}
