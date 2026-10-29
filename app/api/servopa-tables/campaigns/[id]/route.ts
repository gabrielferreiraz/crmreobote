import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { readJsonObjectOrError } from "@/lib/read-body";
import { logAudit } from "@/lib/audit-log";
import { deleteServopaCampaignArt } from "@/lib/r2";
import { dateKeyFromDb, dbDateFromKey } from "@/lib/servopa-tables/campaign-rules";
import {
  describeServopaCampaign,
  firstIssue,
  requireServopaCampaignManager,
  servopaCampaignFieldsSchema,
  servopaCampaignPeriodError,
  servopaCampaignsResponse,
} from "@/lib/servopa-tables/campaign-admin";

export const dynamic = "force-dynamic";

const patchSchema = servopaCampaignFieldsSchema.partial();

/** Edita nome, período, liga/desliga e cor do texto. A arte tem rota própria (./art). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireServopaCampaignManager();
  if ("response" in auth) return auth.response;
  const { access } = auth;

  const limited = rateLimitOrResponse(`servopa-campaign:${access.organizationId}:${access.userId}`, 30, 60_000);
  if (limited) return limited;

  const body = await readJsonObjectOrError(request, 4_096);
  if (body instanceof NextResponse) return body;
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const changes = parsed.data;

  const result = await runWithTenant(access.organizationId, async () => {
    const current = await prisma.servopaCampaign.findFirst({
      where: { id, organizationId: access.organizationId },
      select: { name: true, startsOn: true, endsOn: true, enabled: true },
    });
    if (!current) return { error: "Campanha não encontrada.", status: 404 } as const;

    const merged = {
      name: changes.name ?? current.name,
      startsOn: changes.startsOn !== undefined ? changes.startsOn : dateKeyFromDb(current.startsOn),
      endsOn: changes.endsOn !== undefined ? changes.endsOn : dateKeyFromDb(current.endsOn),
      enabled: changes.enabled ?? current.enabled,
    };
    const periodError = servopaCampaignPeriodError(merged.startsOn, merged.endsOn);
    if (periodError) return { error: periodError, status: 400 } as const;

    await prisma.servopaCampaign.update({
      where: { id },
      data: {
        ...(changes.name !== undefined && { name: changes.name }),
        ...(changes.startsOn !== undefined && { startsOn: dbDateFromKey(changes.startsOn) }),
        ...(changes.endsOn !== undefined && { endsOn: dbDateFromKey(changes.endsOn) }),
        ...(changes.enabled !== undefined && { enabled: changes.enabled }),
        ...(changes.textColor !== undefined && { textColor: changes.textColor }),
        updatedById: access.userId,
      },
    });
    return { merged } as const;
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });

  await logAudit({
    organizationId: access.organizationId,
    actorUserId: access.userId,
    actorName: access.actorName,
    action: "SERVOPA_CAMPAIGN_UPDATED",
    targetType: "ServopaCampaign",
    targetId: id,
    detail: `Alterou a campanha ${describeServopaCampaign(result.merged)}. Campos: ${Object.keys(changes).join(", ") || "nenhum"}.`,
  });

  return servopaCampaignsResponse(access.organizationId);
}

/** Apaga a campanha e as artes dela no R2. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireServopaCampaignManager();
  if ("response" in auth) return auth.response;
  const { access } = auth;

  const limited = rateLimitOrResponse(`servopa-campaign:${access.organizationId}:${access.userId}`, 30, 60_000);
  if (limited) return limited;

  const removed = await runWithTenant(access.organizationId, async () => {
    const campaign = await prisma.servopaCampaign.findFirst({
      where: { id, organizationId: access.organizationId },
      select: { name: true, startsOn: true, endsOn: true, enabled: true, artKey: true, realEstateArtKey: true, movableArtKey: true },
    });
    if (!campaign) return null;
    await prisma.servopaCampaign.delete({ where: { id } });
    return campaign;
  });
  if (!removed) return NextResponse.json({ error: "Campanha não encontrada." }, { status: 404 });

  // Banco primeiro: se o R2 falhar, sobra só um arquivo solto (nunca uma campanha apontando para arte apagada).
  for (const key of [removed.artKey, removed.realEstateArtKey, removed.movableArtKey]) {
    if (key) await deleteServopaCampaignArt(key).catch((error) => console.error("[servopa-campaign] falha ao apagar arte do R2", key, error));
  }

  await logAudit({
    organizationId: access.organizationId,
    actorUserId: access.userId,
    actorName: access.actorName,
    action: "SERVOPA_CAMPAIGN_DELETED",
    targetType: "ServopaCampaign",
    targetId: id,
    detail: `Apagou a campanha ${describeServopaCampaign({ ...removed, startsOn: dateKeyFromDb(removed.startsOn), endsOn: dateKeyFromDb(removed.endsOn) })}.`,
  });

  return servopaCampaignsResponse(access.organizationId);
}
