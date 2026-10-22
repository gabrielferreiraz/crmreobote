import { NextResponse } from "next/server";
import type { $Enums } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { getDealScope } from "@/lib/team-scope";
import { getSharedScope } from "@/lib/share-groups";
import { getCampaignRecipientsPage } from "@/lib/campaigns/list";
import { rateLimitOrResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const RECIPIENT_STATUSES = new Set<$Enums.CampaignRecipientStatus>([
  "PENDING",
  "SENDING",
  "SENT",
  "FAILED",
  "SKIPPED",
]);

function nonNegativeInt(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const limited = rateLimitOrResponse(`campaign-recipients:${access.organizationId}:${access.userId}`, 120, 60_000);
  if (limited) return limited;

  const { id } = await params;
  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status") as $Enums.CampaignRecipientStatus | null;
  const status = statusParam && RECIPIENT_STATUSES.has(statusParam) ? statusParam : undefined;

  return runWithTenant(access.organizationId, async () => {
    const [scope, dealScope] = await Promise.all([
      getDealScope(access.organizationId, access.userId, access.role),
      getSharedScope(access.organizationId, access.userId, access.role, "shareDeals"),
    ]);
    const page = await getCampaignRecipientsPage(access.organizationId, id, scope, dealScope, {
      offset: nonNegativeInt(url.searchParams.get("offset"), 0),
      limit: nonNegativeInt(url.searchParams.get("limit"), 50) || 50,
      q: url.searchParams.get("q") ?? undefined,
      status,
      onlyReplied: url.searchParams.get("replied") === "1",
    });
    if (!page) return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });
    return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
  });
}
