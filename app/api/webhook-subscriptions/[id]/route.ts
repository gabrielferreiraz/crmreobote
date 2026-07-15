import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { VALID_WEBHOOK_EVENTS } from "@/lib/webhooks/enqueue";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { active, events } = body as { active?: boolean; events?: string[] };

  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  let cleanEvents: string[] | undefined;
  if (events !== undefined) {
    cleanEvents = events.filter((e) => VALID_WEBHOOK_EVENTS.includes(e as (typeof VALID_WEBHOOK_EVENTS)[number]));
    if (cleanEvents.length === 0) {
      return NextResponse.json({ error: "Selecione ao menos um evento válido" }, { status: 400 });
    }
  }

  return runWithTenant(access.organizationId, async () => {
    const existing = await prisma.webhookSubscription.findFirst({
      where: { id, organizationId: access.organizationId },
    });
    if (!existing) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });

    const subscription = await prisma.webhookSubscription.update({
      where: { id },
      data: {
        active: active === undefined ? undefined : active,
        events: cleanEvents,
      },
    });

    return NextResponse.json({
      id: subscription.id,
      url: subscription.url,
      events: subscription.events,
      active: subscription.active,
    });
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const existing = await prisma.webhookSubscription.findFirst({
      where: { id, organizationId: access.organizationId },
    });
    if (!existing) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });

    await prisma.webhookSubscription.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  });
}
