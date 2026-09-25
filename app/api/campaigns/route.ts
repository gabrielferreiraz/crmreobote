import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { listCampaigns } from "@/lib/campaigns/list";
import { resolveCampaignInput, type CampaignInput } from "@/lib/campaigns/build";
import { getDealScope } from "@/lib/team-scope";
import type { Prisma } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    // Escopo por papel (ver lib/team-scope.ts) — Consultor só vê as próprias
    // campanhas, Supervisor a da equipe, igual Deal/Task já fazem. Achado em
    // produção sem isso: qualquer um via a campanha de qualquer outro.
    const scope = await getDealScope(access.organizationId, access.userId, access.role);
    const campaigns = await listCampaigns(access.organizationId, scope);
    return NextResponse.json(campaigns);
  });
}

export async function POST(req: Request) {
  const body = (await req.json()) as CampaignInput;

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const scope = await getDealScope(access.organizationId, access.userId, access.role);
    const resolved = await resolveCampaignInput(access.organizationId, body, scope);
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 });
    const v = resolved.value;

    const campaign = await prisma.campaign.create({
      data: {
        organizationId: access.organizationId,
        name: v.name,
        audienceFilter: v.audienceFilter as unknown as Prisma.InputJsonValue,
        instanceId: v.instanceId,
        messageTemplates: v.messageTemplates,
        delayMinSec: v.delayMinSec,
        delayMaxSec: v.delayMaxSec,
        dailyCap: v.dailyCap,
        allowedWeekdays: v.allowedWeekdays,
        windowStartHour: v.windowStartHour,
        windowEndHour: v.windowEndHour,
        followUpEnabled: v.followUpEnabled,
        followUpDelayHours: v.followUpDelayHours,
        followUpTemplates: v.followUpTemplates,
        rmktWaves: v.rmktWaves,
        noReplyDays: v.noReplyDays,
        createdById: access.userId,
      },
    });

    await prisma.campaignRecipient.createMany({
      data: v.contactIds.map((contactId) => ({ campaignId: campaign.id, contactId })),
      skipDuplicates: true,
    });

    return NextResponse.json({ ...campaign, recipientCount: v.contactIds.length }, { status: 201 });
  });
}
