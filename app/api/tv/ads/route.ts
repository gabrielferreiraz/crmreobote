import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { assertValidTvAd, buildTvAdKey, uploadTvAd, deleteTvAdByUrl, TvAdUploadError } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * Upload de imagem de propaganda pra TV (Configurações > TV, ver
 * tv-config-form.tsx) — mesmo mecanismo de app/api/org/members/[userId]/avatar
 * (formData com "file", valida bytes de verdade antes de aceitar), só que
 * sobe pro bucket PÚBLICO de anúncios (ver lib/r2.ts) em vez do privado de
 * avatar/mídia — devolve a URL final pronta, sem indireção de assinatura.
 * Mesmo `requireSession` (sem checar role) que `saveTvConfig` já usa — quem
 * pode salvar a configuração da TV também pode subir a imagem que vai nela.
 */
export async function POST(req: Request) {
  const { organizationId } = await requireSession();
  if (!organizationId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Envie uma imagem" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    assertValidTvAd(file.type, file.size, buffer);
  } catch (err) {
    if (err instanceof TvAdUploadError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  const key = buildTvAdKey(organizationId, file.type);
  const url = await uploadTvAd(key, buffer, file.type);

  return NextResponse.json({ url });
}

/** Remove uma imagem já enviada (botão de lixeira na lista, ver tv-config-form.tsx). */
export async function DELETE(req: Request) {
  const { organizationId } = await requireSession();
  if (!organizationId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { url } = (await req.json().catch(() => ({}))) as { url?: string };
  if (!url) return NextResponse.json({ error: "url é obrigatório" }, { status: 400 });

  await deleteTvAdByUrl(url).catch(() => {});
  return NextResponse.json({ ok: true });
}
