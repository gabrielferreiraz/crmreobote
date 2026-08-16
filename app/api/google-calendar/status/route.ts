import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import { hasCalendarWriteScope } from "@/lib/google-calendar-oauth";

export const dynamic = "force-dynamic";

export async function GET() {
  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const connection = await prisma.googleCalendarConnection.findUnique({
      where: { userId },
      select: { calendarEmail: true, scope: true },
    });
    return NextResponse.json({
      connected: !!connection,
      email: connection?.calendarEmail ?? null,
      // false pra uma conexão feita antes do escopo de escrita existir (ver
      // hasCalendarWriteScope) — a tela de Perfil usa isso pra avisar
      // "reconecte" em vez de deixar descobrir só quando um agendamento via
      // API v1 falhar com 403 (ver POST /api/v1/appointments).
      hasWriteScope: connection ? hasCalendarWriteScope(connection.scope) : null,
    });
  });
}
