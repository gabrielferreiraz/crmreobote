import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { requireAcademyToken } from "@/lib/require-academy-token";
import { rateLimitOrResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** GET /api/academy/progresso/me — aulas concluídas pelo usuário do TOKEN (nunca um userId de query/corpo). */
export async function GET(req: Request) {
  const access = await requireAcademyToken(req);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const rateLimited = rateLimitOrResponse(`academy:${access.userId}:progresso-me`, 60, 60_000);
  if (rateLimited) return rateLimited;

  const rows = await runWithTenant(access.organizationId, () =>
    prisma.progresso.findMany({
      where: { organizationId: access.organizationId, userId: access.userId },
      select: { aulaId: true },
    }),
  );

  return NextResponse.json({ completedLessonIds: rows.map((r) => r.aulaId) });
}
