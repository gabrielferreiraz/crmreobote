import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { listCampaigns } from "@/lib/campaigns/list";
import { resolveCampaignInput, type CampaignInput } from "@/lib/campaigns/build";
import type { Prisma } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireRole(["OWNER", "ADMIN"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const campaigns = await listCampaigns(access.organizationId);
    return NextResponse.json(campaigns);
  });
}

export async function POST(req: Request) {
  const body = (await req.json()) as CampaignInput;

  const access = await requireRole(["OWNER", "ADMIN"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const resolved = await resolveCampaignInput(access.organizationId, body);
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
