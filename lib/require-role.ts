import { getCurrentMembership } from "@/lib/current-membership";

export async function requireRole(roles: Array<"OWNER" | "MANAGER" | "SUPERVISOR" | "MEMBER">) {
  const membership = await getCurrentMembership();
  if (!membership?.active) {
    return { ok: false as const, session: null, organizationId: null };
  }

  if (!roles.includes(membership.role)) {
    return { ok: false as const, session: membership.session, organizationId: membership.organizationId };
  }

  return {
    ok: true as const,
    session: membership.session,
    organizationId: membership.organizationId,
    userId: membership.userId,
    role: membership.role,
  };
}
