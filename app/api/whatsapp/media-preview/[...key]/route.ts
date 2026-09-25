import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { getChatMediaObject } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * Prévia autenticada de imagem anexada a um script. Diferente da rota
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
  if (!object || !object.contentType.startsWith("image/")) {
    return NextResponse.json({ error: "Imagem não encontrada" }, { status: 404 });
  }

  return new NextResponse(new Blob([object.body.slice()]), {
    headers: {
      "Content-Type": object.contentType,
      "Cache-Control": "private, max-age=60",
    },
  });
}
