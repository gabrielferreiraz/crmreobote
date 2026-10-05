import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { readFormData, bodyErrorResponse, BODY_LIMITS } from "@/lib/read-body";
import {
  assertValidAvatar,
  buildCardCoverPhotoKey,
  uploadAvatar,
  deleteAvatar,
  resolveAvatarUrl,
  resizeCoverPhoto,
  AvatarUploadError,
} from "@/lib/r2";
import { clearOrgCardDefault, setOrgCardDefault } from "@/lib/digital-cards/org-defaults";
import { MAX_CARD_COVER_PHOTOS, parseCardCoverPhotoKeys } from "@/lib/digital-cards/cover-photos";
import { getCardDetails } from "@/lib/digital-cards/queries";

export const dynamic = "force-dynamic";

/**
 * Upload da foto de capa (banner do topo do cartão) — mesmo esqueleto de
 * app/api/digital-cards/[id]/photo/route.ts (foto de perfil do cartão), só
 * troca resizeAvatar/buildCardPhotoKey por resizeCoverPhoto (proporção
 * paisagem)/buildCardCoverPhotoKey. Pedido explícito depois da conversa
 * sobre a ideia do Gemini pra foto de fundo do cartão.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const isAppend = url.searchParams.get("append") === "true";

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { organizationId, userId, role } = access;

  // Lido só depois da autenticação e com teto (lib/read-body.ts) — antes
  // req.formData() carregava o corpo INTEIRO pra memória antes de checar tamanho.
  let formData: FormData;
  try {
    formData = await readFormData(req, BODY_LIMITS.image);
  } catch (err) {
    const res = bodyErrorResponse(err);
    if (res) return res;
    throw err;
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Envie uma imagem" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    assertValidAvatar(file.type, file.size, buffer);
  } catch (err) {
    if (err instanceof AvatarUploadError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }

  return runWithTenant(organizationId, async () => {
    const card = await prisma.digitalCard.findUnique({ where: { id } });
    if (!card || card.organizationId !== organizationId) {
      return NextResponse.json({ error: "Cartão não encontrado" }, { status: 404 });
    }
    if (card.userId !== userId && !["OWNER", "MANAGER"].includes(role)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    const existingKeys = parseCardCoverPhotoKeys(card.coverPhotoKey);
    if (isAppend && existingKeys.length >= MAX_CARD_COVER_PHOTOS) {
      return NextResponse.json({ error: "Você pode enviar no máximo 4 fotos de capa." }, { status: 400 });
    }

    const resized = await resizeCoverPhoto(buffer, file.type);
    const key = buildCardCoverPhotoKey(id, file.type);
    await uploadAvatar(key, resized, file.type);

    let updatedKeys: string[];
    if (isAppend) {
      updatedKeys = [...existingKeys, key];
    } else {
      updatedKeys = [key];
    }

    const newKeyStr = updatedKeys.join(",");
    await prisma.digitalCard.update({ where: { id }, data: { coverPhotoKey: newKeyStr } });
    const isOwnerCard = role === "OWNER" && card.userId === userId;
    if (isOwnerCard) await setOrgCardDefault(organizationId, "cover", newKeyStr);

    if (!isAppend) {
      for (const oldKey of existingKeys) {
        await deleteAvatar(oldKey).catch(() => {});
      }
    }

    const coverPhotoUrls = await Promise.all(updatedKeys.map((k) => resolveAvatarUrl(k)));
    const validUrls = coverPhotoUrls.filter((u): u is string => !!u);
    return NextResponse.json({
      coverPhotoUrl: validUrls[0] ?? null,
      coverPhotoUrls: validUrls,
      ownCoverPhotoUrls: validUrls,
      organizationDefault: isOwnerCard,
    });
  });
}

/** Remove foto de capa — se passar ?index=N apaga só aquela foto; senão apaga todas. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const indexParam = url.searchParams.get("index");

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { organizationId, userId, role } = access;

  return runWithTenant(organizationId, async () => {
    const card = await prisma.digitalCard.findUnique({ where: { id } });
    if (!card || card.organizationId !== organizationId) {
      return NextResponse.json({ error: "Cartão não encontrado" }, { status: 404 });
    }
    if (card.userId !== userId && !["OWNER", "MANAGER"].includes(role)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    const existingKeys = parseCardCoverPhotoKeys(card.coverPhotoKey);
    const isOwnerCard = role === "OWNER" && card.userId === userId;

    if (indexParam !== null) {
      const idx = parseInt(indexParam, 10);
      if (isNaN(idx) || idx < 0 || idx >= existingKeys.length) {
        return NextResponse.json({ error: "Índice de foto inválido" }, { status: 400 });
      }
      const keyToRemove = existingKeys[idx];
      const remainingKeys = existingKeys.filter((_, i) => i !== idx);
      const newKeyStr = remainingKeys.length > 0 ? remainingKeys.join(",") : null;

      await prisma.digitalCard.update({ where: { id }, data: { coverPhotoKey: newKeyStr } });
      if (isOwnerCard) {
        if (newKeyStr) await setOrgCardDefault(organizationId, "cover", newKeyStr);
        else await clearOrgCardDefault(organizationId, "cover");
      }
      await deleteAvatar(keyToRemove).catch(() => {});

      const updated = await getCardDetails(id);
      return NextResponse.json({
        ok: true,
        coverPhotoUrl: updated?.coverPhotoUrl ?? null,
        coverPhotoUrls: updated?.coverPhotoUrls ?? [],
        ownCoverPhotoUrls: remainingKeys.length > 0 ? updated?.coverPhotoUrls ?? [] : [],
        organizationDefault: isOwnerCard && remainingKeys.length > 0,
      });
    }

    await prisma.digitalCard.update({ where: { id }, data: { coverPhotoKey: null } });
    if (isOwnerCard) await clearOrgCardDefault(organizationId, "cover");
    for (const key of existingKeys) {
      await deleteAvatar(key).catch(() => {});
    }

    const updated = await getCardDetails(id);
    return NextResponse.json({
      ok: true,
      coverPhotoUrl: updated?.coverPhotoUrl ?? null,
      coverPhotoUrls: updated?.coverPhotoUrls ?? [],
      ownCoverPhotoUrls: [],
      organizationDefault: false,
    });
  });
}
