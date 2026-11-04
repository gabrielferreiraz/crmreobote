import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { getChatMediaObject } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * Prévia autenticada de imagem/vídeo anexado a um script. Diferente da rota
 * media-file (que serve somente a Evolution via token), o navegador precisa
 * provar a sessão e só pode ler chaves da sua própria organização.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { organizationId } = await requireSession();
  if (!organizationId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { key: keyParts } = await params;
  const key = keyParts.join("/");
  if (!key.startsWith(`whatsapp-media/${organizationId}/`)) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  }

  const object = await getChatMediaObject(key);
  // Só imagem/vídeo: a rota devolve o arquivo com o Content-Type do bucket, e
  // a lista de tipos aceitos no upload (CHAT_MEDIA_ALLOWED_TYPES) não deve ser
  // a única barreira contra servir algo que o navegador execute.
  if (!object || !(object.contentType.startsWith("image/") || object.contentType.startsWith("video/"))) {
    return NextResponse.json({ error: "Arquivo não encontrado" }, { status: 404 });
  }

  return new NextResponse(new Blob([object.body.slice()]), {
    headers: {
      "Content-Type": object.contentType,
      "Cache-Control": "private, max-age=60",
    },
  });
}
