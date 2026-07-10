import { NextResponse } from "next/server";
import { getChatMediaObject } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * Chamado pelo Evolution API, nunca pelo navegador — é de onde ele baixa a
 * mídia pra reenviar/converter pro WhatsApp (ver buildEvolutionMediaUrl em
 * lib/whatsapp/send.ts). Existe em vez de uma URL assinada do R2 porque o
 * Evolution acrescenta um "?timestamp=" na URL antes de baixar, o que
 * invalida a assinatura de uma URL de query-string (o R2 responde 403).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key: keyParts } = await params;
  const key = keyParts.join("/");

  // Só serve chaves deste namespace — nunca vira um proxy aberto pro resto do bucket (avatares, etc).
  if (!key.startsWith("whatsapp-media/")) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  }

  const object = await getChatMediaObject(key);
  if (!object) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

  return new NextResponse(new Blob([object.body.slice()]), { headers: { "Content-Type": object.contentType } });
}
