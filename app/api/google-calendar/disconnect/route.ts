import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import { logAudit } from "@/lib/audit-log";
import { getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { organizationId, userId, session } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const existing = await prisma.googleCalendarConnection.findUnique({ where: { userId } });
    await prisma.googleCalendarConnection.deleteMany({ where: { userId } });

    if (existing) {
      await logAudit({
        organizationId,
        actorUserId: userId,
        actorName: session!.user.name ?? session!.user.email ?? "?",
        action: "GOOGLE_CALENDAR_DISCONNECTED",
        targetType: "GoogleCalendarConnection",
        detail: existing.calendarEmail,
        ip: getClientIp(req),
      });
    }

    return NextResponse.json({ ok: true });
  });
}
