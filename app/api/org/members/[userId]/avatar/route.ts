import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import {
  assertValidAvatar,
  buildAvatarKey,
  uploadAvatar,
  deleteAvatar,
  resolveAvatarUrl,
  AvatarUploadError,
} from "@/lib/r2";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const formData = await req.formData();

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  if (access.role !== "OWNER" && access.userId !== userId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Envie uma imagem" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    assertValidAvatar(file.type, file.size, buffer);
  } catch (err) {
    if (err instanceof AvatarUploadError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  return runWithTenant(access.organizationId, async () => {
    const membership = await prisma.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId: access.organizationId, userId } },
    });
    if (!membership) return NextResponse.json({ error: "Membro não encontrado" }, { status: 404 });

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { image: true } });
    const previousKey = user?.image?.startsWith("avatars/") ? user.image : null;

    const key = buildAvatarKey(userId, file.type);
    await uploadAvatar(key, buffer, file.type);

    await prisma.user.update({ where: { id: userId }, data: { image: key } });

    if (previousKey) {
      await deleteAvatar(previousKey).catch(() => {});
    }

    const url = await resolveAvatarUrl(key);
    return NextResponse.json({ url });
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  if (access.role !== "OWNER" && access.userId !== userId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  return runWithTenant(access.organizationId, async () => {
    const membership = await prisma.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId: access.organizationId, userId } },
    });
    if (!membership) return NextResponse.json({ error: "Membro não encontrado" }, { status: 404 });

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { image: true } });
    const previousKey = user?.image?.startsWith("avatars/") ? user.image : null;

    await prisma.user.update({ where: { id: userId }, data: { image: null } });

    if (previousKey) {
      await deleteAvatar(previousKey).catch(() => {});
    }

    return NextResponse.json({ ok: true });
  });
}
