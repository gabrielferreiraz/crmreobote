import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { assertValidChatMedia, buildChatMediaKey, uploadChatMedia, ChatMediaUploadError } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * Recebe o arquivo de imagem/áudio escolhido/gravado no composer do chat e
 * devolve só a chave do R2 — nunca uma URL assinada aqui, porque essa URL só
 * precisa existir na hora do envio de fato (ver resolveChatMediaUrl em
 * lib/whatsapp/send.ts) ou quando o chat carrega o histórico.
 */
export async function POST(req: Request) {
  const { organizationId } = await requireSession();
  if (!organizationId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Envie um arquivo" }, { status: 400 });
  }

  try {
    assertValidChatMedia(file.type, file.size);
  } catch (err) {
    if (err instanceof ChatMediaUploadError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const key = buildChatMediaKey(organizationId, file.type);
  await uploadChatMedia(key, buffer, file.type);

  return NextResponse.json({ key });
}
