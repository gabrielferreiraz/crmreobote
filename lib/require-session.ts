import { getCurrentMembership } from "@/lib/current-membership";
import { isCrmRestrictedByAcademy } from "@/lib/academy-onboarding";

export async function requireSession() {
  const membership = await getCurrentMembership();
  if (
    !membership?.active ||
    isCrmRestrictedByAcademy(membership.role, membership.area, membership.academyOnboardingStatus)
  ) {
    return { session: null, organizationId: null } as const;
  }

  return {
    session: membership.session,
    organizationId: membership.organizationId,
    userId: membership.userId,
  } as const;
}
