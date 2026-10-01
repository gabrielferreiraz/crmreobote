import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
let lastCleanupAt = 0;

/**
 * Deletes only credentials that can no longer be used. Used authorization
 * codes remain while derived tokens exist because those tokens reference the
 * original code with cascading foreign keys.
 */
export async function cleanupExpiredAcademyCredentials(): Promise<{ skipped: boolean; deleted: number }> {
  const nowMs = Date.now();
  if (nowMs - lastCleanupAt < CLEANUP_INTERVAL_MS) return { skipped: true, deleted: 0 };

  const organizations = await prisma.organization.findMany({ select: { id: true } });
  let deleted = 0;

  for (const { id: organizationId } of organizations) {
    const result = await runWithTenant(organizationId, async () => {
      const now = new Date();
      const [access, refresh] = await Promise.all([
        prisma.academyAccessToken.deleteMany({ where: { expiresAt: { lt: now } } }),
        prisma.academyRefreshToken.deleteMany({ where: { sessionExpiresAt: { lt: now } } }),
      ]);
      const codes = await prisma.academyAuthCode.deleteMany({
        where: {
          expiresAt: { lt: now },
          accessTokens: { none: {} },
          refreshTokens: { none: {} },
        },
      });
      return access.count + refresh.count + codes.count;
    });
    deleted += result;
  }

  lastCleanupAt = nowMs;
  return { skipped: false, deleted };
}
