import { NextResponse } from "next/server";
import { requireRole } from "@/lib/require-role";
import { assertValidTvAd, buildTvAdKey, uploadTvAd, deleteTvAdByUrl, TvAdUploadError } from "@/lib/r2";
import { readFormData, readJson, bodyErrorResponse, BODY_LIMITS } from "@/lib/read-body";

export const dynamic = "force-dynamic";

/**
 * Upload de imagem de propaganda pra TV (Configurações > TV, ver
 * tv-config-form.tsx) — mesmo mecanismo de app/api/org/members/[userId]/avatar
 * (formData com "file", valida bytes de verdade antes de aceitar), só que
 * sobe pro bucket PÚBLICO de anúncios (ver lib/r2.ts) em vez do privado de
 * avatar/mídia — devolve a URL final pronta, sem indireção de assinatura.
 *
 * Só Dono/Gerente — mesmo papel que saveTvConfig (a TV fica à vista de
 * cliente). Autentica ANTES de ler o arquivo, e lê com teto (lib/read-body.ts).
 */
export async function POST(req: Request) {
  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Só o dono ou um gerente pode alterar a TV." }, { status: 403 });

  let formData: FormData;
  try {
    formData = await readFormData(req, BODY_LIMITS.image);
  } catch (err) {
    const res = bodyErrorResponse(err);
    if (res) return res;
    throw err;
  }

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

  const key = buildTvAdKey(access.organizationId, file.type);
  const url = await uploadTvAd(key, buffer, file.type);

  return NextResponse.json({ url });
}

/** Remove uma imagem já enviada (botão de lixeira na lista, ver tv-config-form.tsx) — só anúncio DESTA organização. */
export async function DELETE(req: Request) {
  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Só o dono ou um gerente pode alterar a TV." }, { status: 403 });

  let url: string | undefined;
  try {
    ({ url } = await readJson<{ url?: string }>(req));
  } catch (err) {
    const res = bodyErrorResponse(err);
    if (res) return res;
    throw err;
  }
  if (!url) return NextResponse.json({ error: "url é obrigatório" }, { status: 400 });

  await deleteTvAdByUrl(url, access.organizationId).catch(() => {});
  return NextResponse.json({ ok: true });
}
