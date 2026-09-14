import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import {
  assertValidAvatar,
  buildCardPhotoKey,
  uploadAvatar,
  deleteAvatar,
  resolveAvatarUrl,
  resizeAvatar,
  AvatarUploadError,
} from "@/lib/r2";

export const dynamic = "force-dynamic";

/** Mesmo pipeline de validação/redimensionamento do avatar normal — ver comentário em lib/r2.ts (buildCardPhotoKey). */
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

    const resized = await resizeAvatar(buffer, file.type);
    const key = buildCardPhotoKey(id, file.type);
    await uploadAvatar(key, resized, file.type);

    const previousKey = card.photoKey;
    await prisma.digitalCard.update({ where: { id }, data: { photoKey: key } });
    if (previousKey) await deleteAvatar(previousKey).catch(() => {});

    const photoUrl = await resolveAvatarUrl(key);
    return NextResponse.json({ photoUrl });
  });
}

/** Remove o override — volta a cair pro User.image por padrão. */
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

    await prisma.digitalCard.update({ where: { id }, data: { photoKey: null } });
    if (card.photoKey) await deleteAvatar(card.photoKey).catch(() => {});

    return NextResponse.json({ ok: true });
  });
}
