import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { readJsonObjectOrError } from "@/lib/read-body";
import { logAudit } from "@/lib/audit-log";
import { dbDateFromKey } from "@/lib/servopa-tables/campaign-rules";
import { listServopaCampaigns } from "@/lib/servopa-tables/campaigns";
import {
  describeServopaCampaign,
  firstIssue,
  requireServopaCampaignManager,
  servopaCampaignFieldsSchema,
  servopaCampaignPeriodError,
  servopaCampaignsResponse,
} from "@/lib/servopa-tables/campaign-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireServopaCampaignManager();
  if ("response" in auth) return auth.response;
  return servopaCampaignsResponse(auth.access.organizationId);
}

/** Nova campanha (sem arte ainda: a arte é enviada depois, em /[id]/art). Não há limite de quantidade. */
export async function POST(request: Request) {
  const auth = await requireServopaCampaignManager();
  if ("response" in auth) return auth.response;
  const { access } = auth;

  const limited = rateLimitOrResponse(`servopa-campaign:${access.organizationId}:${access.userId}`, 30, 60_000);
  if (limited) return limited;

  const body = await readJsonObjectOrError(request, 4_096);
  if (body instanceof NextResponse) return body;
  const parsed = servopaCampaignFieldsSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const fields = parsed.data;
  const periodError = servopaCampaignPeriodError(fields.startsOn, fields.endsOn);
  if (periodError) return NextResponse.json({ error: periodError }, { status: 400 });

  const created = await runWithTenant(access.organizationId, () =>
    prisma.servopaCampaign.create({
      data: {
        organizationId: access.organizationId,
        name: fields.name,
        startsOn: dbDateFromKey(fields.startsOn),
        endsOn: dbDateFromKey(fields.endsOn),
        enabled: fields.enabled,
        textColor: fields.textColor,
        createdById: access.userId,
        updatedById: access.userId,
      },
      select: { id: true },
    }),
  );

  await logAudit({
    organizationId: access.organizationId,
    actorUserId: access.userId,
    actorName: access.actorName,
    action: "SERVOPA_CAMPAIGN_CREATED",
    targetType: "ServopaCampaign",
    targetId: created.id,
    detail: `Criou a campanha ${describeServopaCampaign(fields)}.`,
  });

  return NextResponse.json({ campaigns: await listServopaCampaigns(access.organizationId), createdId: created.id }, { status: 201 });
}
