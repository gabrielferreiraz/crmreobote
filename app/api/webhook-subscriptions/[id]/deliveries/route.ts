import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const subscription = await prisma.webhookSubscription.findFirst({
      where: { id, organizationId: access.organizationId },
    });
    if (!subscription) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });

    const deliveries = await prisma.webhookDelivery.findMany({
      where: { subscriptionId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json(
      deliveries.map((d) => ({
        id: d.id,
        event: d.event,
        status: d.status,
        attempts: d.attempts,
        responseStatus: d.responseStatus,
        nextAttemptAt: d.nextAttemptAt,
        createdAt: d.createdAt,
      })),
    );
  });
}
