import { NextResponse } from "next/server";
import { getCurrentMembership } from "@/lib/current-membership";
import { evaluateAllTips } from "@/lib/productivity-tips/engine";
import { isCrmRestrictedByAcademy } from "@/lib/academy-onboarding";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // requireSession() não expõe `role` (só session/organizationId/userId) —
  // precisamos do papel pra escopo de negócios (getSharedScope), então vai
  // direto na fonte que ele mesmo usa por baixo.
  const membership = await getCurrentMembership();
  if (
    !membership?.active ||
    isCrmRestrictedByAcademy(membership.role, membership.area, membership.academyOnboardingStatus)
  ) {
    return NextResponse.json({ tip: null });
  }
  const { organizationId, userId, role } = membership;

  const url = new URL(req.url);
  const pathname = url.searchParams.get("pathname") ?? "/";

  try {
    const tip = await evaluateAllTips({ organizationId, userId, role, pathname });
    return NextResponse.json({ tip });
  } catch (err) {
    console.error("[productivity-tips] evaluate error", err);
    return NextResponse.json({ tip: null });
  }
}
