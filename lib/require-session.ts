import { getCurrentMembership } from "@/lib/current-membership";

export async function requireSession() {
  const membership = await getCurrentMembership();
  if (!membership?.active) {
    return { session: null, organizationId: null } as const;
  }

  return {
    session: membership.session,
    organizationId: membership.organizationId,
    userId: membership.userId,
  } as const;
}
