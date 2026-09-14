import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import {
  assertValidAvatar,
  buildCardCoverPhotoKey,
  uploadAvatar,
  deleteAvatar,
  resolveAvatarUrl,
  resizeCoverPhoto,
  AvatarUploadError,
} from "@/lib/r2";

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
  const formData = await req.formData();

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { organizationId, userId, role } = access;

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

    const resized = await resizeCoverPhoto(buffer, file.type);
    const key = buildCardCoverPhotoKey(id, file.type);
    await uploadAvatar(key, resized, file.type);

    const previousKey = card.coverPhotoKey;
    await prisma.digitalCard.update({ where: { id }, data: { coverPhotoKey: key } });
    if (previousKey) await deleteAvatar(previousKey).catch(() => {});

    const coverPhotoUrl = await resolveAvatarUrl(key);
    return NextResponse.json({ coverPhotoUrl });
  });
}

/** Remove a foto de capa própria — volta a cair pro padrão da organização/gradiente (ver lib/digital-cards/config.ts). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

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

    await prisma.digitalCard.update({ where: { id }, data: { coverPhotoKey: null } });
    if (card.coverPhotoKey) await deleteAvatar(card.coverPhotoKey).catch(() => {});

    return NextResponse.json({ ok: true });
  });
}
