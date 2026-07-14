import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function GET() {
  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const connection = await prisma.googleCalendarConnection.findUnique({
      where: { userId },
      select: { calendarEmail: true },
    });
    return NextResponse.json({ connected: !!connection, email: connection?.calendarEmail ?? null });
  });
}
