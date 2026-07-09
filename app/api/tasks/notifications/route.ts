import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function GET() {
  const { organizationId, userId } = await requireSession();
  if (!organizationId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const tasks = await prisma.task.findMany({
      where: {
        organizationId,
        ownerId: userId,
        completedAt: null,
        dueAt: { lte: new Date() },
      },
      orderBy: { dueAt: "asc" },
      select: {
        id: true,
        type: true,
        title: true,
        dueAt: true,
        deal: { select: { id: true, name: true } },
        contact: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(tasks);
  });
}
