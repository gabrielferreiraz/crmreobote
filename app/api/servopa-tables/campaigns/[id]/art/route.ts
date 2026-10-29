import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { BODY_LIMITS, bodyErrorResponse, readFormData } from "@/lib/read-body";
import { logAudit } from "@/lib/audit-log";
import {
  AvatarUploadError,
  assertValidServopaCampaignArt,
  buildServopaCampaignArtKey,
  deleteServopaCampaignArt,
  resizeServopaCampaignArt,
  uploadServopaCampaignArt,
} from "@/lib/r2";
import { SERVOPA_CAMPAIGN_ART_SLOTS, type ServopaCampaignArtSlot } from "@/lib/servopa-tables/campaign-rules";
import {
  requireServopaCampaignManager,
  SERVOPA_CAMPAIGN_ART_COLUMN,
  SERVOPA_CAMPAIGN_ART_LABEL,
  servopaCampaignsResponse,
} from "@/lib/servopa-tables/campaign-admin";

export const dynamic = "force-dynamic";

function slotFrom(request: Request): ServopaCampaignArtSlot | null {
  const slot = new URL(request.url).searchParams.get("slot") ?? "ALL";
  return (SERVOPA_CAMPAIGN_ART_SLOTS as readonly string[]).includes(slot) ? (slot as ServopaCampaignArtSlot) : null;
}

async function findCampaign(organizationId: string, id: string) {
  return runWithTenant(organizationId, () =>
    prisma.servopaCampaign.findFirst({
      where: { id, organizationId },
      select: { id: true, name: true, artKey: true, realEstateArtKey: true, movableArtKey: true },
    }),
  );
}

/**
 * Envia ou TROCA a arte (?slot=ALL|REAL_ESTATE|MOVABLE): sobe a nova no R2,
 * grava a chave nova e só então apaga a antiga do R2. A troca só vale se a
 * chave no banco ainda for a que foi lida — dois envios ao mesmo tempo não
 * deixam arquivo órfão nem campanha apontando para arte apagada.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireServopaCampaignManager();
  if ("response" in auth) return auth.response;
  const { access } = auth;

  const slot = slotFrom(request);
  if (!slot) return NextResponse.json({ error: "Tipo de arte inválido." }, { status: 400 });

  const limited = rateLimitOrResponse(`servopa-campaign-art:${access.organizationId}:${access.userId}`, 20, 60_000);
  if (limited) return limited;

  let formData: FormData;
  try {
    formData = await readFormData(request, BODY_LIMITS.image);
  } catch (error) {
    const response = bodyErrorResponse(error);
    if (response) return response;
    throw error;
  }
  const file = formData.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Escolha uma imagem." }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    assertValidServopaCampaignArt(file.type, file.size, buffer);
  } catch (error) {
    if (error instanceof AvatarUploadError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }

  const campaign = await findCampaign(access.organizationId, id);
  if (!campaign) return NextResponse.json({ error: "Campanha não encontrada." }, { status: 404 });

  const column = SERVOPA_CAMPAIGN_ART_COLUMN[slot];
  const previousKey = campaign[column];
  let resized: Buffer;
  try {
    resized = await resizeServopaCampaignArt(buffer, file.type);
  } catch {
    return NextResponse.json({ error: "Não foi possível ler esta imagem. Tente salvar de novo como PNG ou JPEG." }, { status: 400 });
  }
  const key = buildServopaCampaignArtKey(access.organizationId, file.type);
  await uploadServopaCampaignArt(key, resized, file.type);

  let swapped = 0;
  try {
    const result = await runWithTenant(access.organizationId, () =>
      prisma.servopaCampaign.updateMany({
        where: { id, organizationId: access.organizationId, [column]: previousKey },
        data: { [column]: key, updatedById: access.userId },
      }),
    );
    swapped = result.count;
  } finally {
    if (swapped === 0) await deleteServopaCampaignArt(key).catch((error) => console.error("[servopa-campaign] falha ao desfazer envio no R2", key, error));
  }
  if (swapped === 0) {
    return NextResponse.json({ error: "A campanha mudou enquanto a imagem era enviada. Atualize a página e tente de novo." }, { status: 409 });
  }

  if (previousKey) {
    await deleteServopaCampaignArt(previousKey).catch((error) => console.error("[servopa-campaign] falha ao apagar arte antiga do R2", previousKey, error));
  }

  await logAudit({
    organizationId: access.organizationId,
    actorUserId: access.userId,
    actorName: access.actorName,
    action: "SERVOPA_CAMPAIGN_UPDATED",
    targetType: "ServopaCampaign",
    targetId: id,
    detail: `${previousKey ? "Trocou" : "Enviou"} a ${SERVOPA_CAMPAIGN_ART_LABEL[slot]} da campanha "${campaign.name}".`,
  });

  return servopaCampaignsResponse(access.organizationId);
}

/** Remove a arte daquele tipo (banco e R2). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireServopaCampaignManager();
  if ("response" in auth) return auth.response;
  const { access } = auth;

  const slot = slotFrom(request);
  if (!slot) return NextResponse.json({ error: "Tipo de arte inválido." }, { status: 400 });

  const limited = rateLimitOrResponse(`servopa-campaign-art:${access.organizationId}:${access.userId}`, 20, 60_000);
  if (limited) return limited;

  const campaign = await findCampaign(access.organizationId, id);
  if (!campaign) return NextResponse.json({ error: "Campanha não encontrada." }, { status: 404 });

  const column = SERVOPA_CAMPAIGN_ART_COLUMN[slot];
  const previousKey = campaign[column];
  if (!previousKey) return servopaCampaignsResponse(access.organizationId);

  const result = await runWithTenant(access.organizationId, () =>
    prisma.servopaCampaign.updateMany({
      where: { id, organizationId: access.organizationId, [column]: previousKey },
      data: { [column]: null, updatedById: access.userId },
    }),
  );
  if (result.count === 0) {
    return NextResponse.json({ error: "A campanha mudou enquanto a arte era removida. Atualize a página e tente de novo." }, { status: 409 });
  }
  await deleteServopaCampaignArt(previousKey).catch((error) => console.error("[servopa-campaign] falha ao apagar arte do R2", previousKey, error));

  await logAudit({
    organizationId: access.organizationId,
    actorUserId: access.userId,
    actorName: access.actorName,
    action: "SERVOPA_CAMPAIGN_UPDATED",
    targetType: "ServopaCampaign",
    targetId: id,
    detail: `Removeu a ${SERVOPA_CAMPAIGN_ART_LABEL[slot]} da campanha "${campaign.name}".`,
  });

  return servopaCampaignsResponse(access.organizationId);
}
