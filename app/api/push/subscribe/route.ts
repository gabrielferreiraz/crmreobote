import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import { readJsonObjectOrError } from "@/lib/read-body";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readJsonObjectOrError(req);
  if (body instanceof NextResponse) return body;
  const { endpoint, keys } = body as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };

  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return NextResponse.json({ error: "Inscrição de notificação inválida" }, { status: 400 });
  }

  return runWithTenant(organizationId, async () => {
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { userId, endpoint, p256dh: keys.p256dh!, auth: keys.auth! },
      update: { userId, p256dh: keys.p256dh!, auth: keys.auth! },
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  });
}

export async function DELETE(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { endpoint } = body as { endpoint?: string };

  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!endpoint) return NextResponse.json({ error: "endpoint é obrigatório" }, { status: 400 });

  return runWithTenant(organizationId, async () => {
    await prisma.pushSubscription.deleteMany({ where: { endpoint, userId } });
    return NextResponse.json({ ok: true });
  });
}
