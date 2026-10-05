import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { readFormData, bodyErrorResponse, BODY_LIMITS } from "@/lib/read-body";
import {
  assertValidAvatar,
  buildCardBackgroundKey,
  uploadAvatar,
  deleteAvatar,
  resolveAvatarUrl,
  resizeBackgroundPhoto,
  AvatarUploadError,
} from "@/lib/r2";
import { clearOrgCardDefault, setOrgCardDefault } from "@/lib/digital-cards/org-defaults";
import { getCardDetails } from "@/lib/digital-cards/queries";

export const dynamic = "force-dynamic";

/**
 * Upload do fundo do CORPO INTEIRO do cartão (atrás de botões/ícones/
 * rodapé — distinto da capa, que fica só atrás do avatar) — mesmo
 * esqueleto de app/api/digital-cards/[id]/cover/route.ts, só troca
 * resizeCoverPhoto/buildCardCoverPhotoKey por resizeBackgroundPhoto
 * (proporção retrato)/buildCardBackgroundKey. Pedido explícito: "a capa de
 * fundo atrás do avatar e outra de fundo com todo o corpo do cartão" são
 * duas imagens distintas.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

    const resized = await resizeBackgroundPhoto(buffer, file.type);
    const key = buildCardBackgroundKey(id, file.type);
    await uploadAvatar(key, resized, file.type);

    const previousKey = card.backgroundPhotoKey;
    await prisma.digitalCard.update({ where: { id }, data: { backgroundPhotoKey: key } });
    const isOwnerCard = role === "OWNER" && card.userId === userId;
    if (isOwnerCard) await setOrgCardDefault(organizationId, "background", key);
    if (previousKey) await deleteAvatar(previousKey).catch(() => {});

    const backgroundPhotoUrl = await resolveAvatarUrl(key);
    return NextResponse.json({ backgroundPhotoUrl, ownBackgroundPhotoUrl: backgroundPhotoUrl, organizationDefault: isOwnerCard });
  });
}

/** Remove o fundo próprio — volta a cair pro padrão da organização/gradiente (ver lib/digital-cards/config.ts). */
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

    await prisma.digitalCard.update({ where: { id }, data: { backgroundPhotoKey: null } });
    const isOwnerCard = role === "OWNER" && card.userId === userId;
    if (isOwnerCard) await clearOrgCardDefault(organizationId, "background");
    if (card.backgroundPhotoKey) await deleteAvatar(card.backgroundPhotoKey).catch(() => {});

    const updated = await getCardDetails(id);
    return NextResponse.json({
      ok: true,
      backgroundPhotoUrl: updated?.backgroundPhotoUrl ?? null,
      ownBackgroundPhotoUrl: null,
      organizationDefault: false,
    });
  });
}
