import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { generateWebhookSecret } from "@/lib/webhooks/sign";
import { VALID_WEBHOOK_EVENTS } from "@/lib/webhooks/enqueue";
import { isUrlSafeToFetch } from "@/lib/webhooks/url-safety";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const subscriptions = await prisma.webhookSubscription.findMany({
      where: { organizationId: access.organizationId },
      orderBy: { createdAt: "desc" },
      include: { createdBy: { select: { name: true } } },
    });
    return NextResponse.json(
      subscriptions.map((s) => ({
        id: s.id,
        url: s.url,
        events: s.events,
        active: s.active,
        createdByName: s.createdBy.name,
        createdAt: s.createdAt,
      })),
    );
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const { url, events } = body as { url?: string; events?: string[] };

  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  if (!url?.trim()) return NextResponse.json({ error: "URL é obrigatória" }, { status: 400 });
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url.trim());
  } catch {
    return NextResponse.json({ error: "URL inválida" }, { status: 400 });
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return NextResponse.json({ error: "URL precisa ser http(s)" }, { status: 400 });
  }
  // Servidor é quem faz o fetch de verdade na entrega (lib/webhooks/engine.ts)
  // — bloqueia URL apontando pra rede interna/loopback/metadados de nuvem,
  // senão vira um SSRF a partir do próprio servidor.
  if (!(await isUrlSafeToFetch(parsedUrl.toString()))) {
    return NextResponse.json({ error: "URL não permitida — precisa apontar pra um host público" }, { status: 400 });
  }

  const cleanEvents = (events ?? []).filter((e) => VALID_WEBHOOK_EVENTS.includes(e as (typeof VALID_WEBHOOK_EVENTS)[number]));
  if (cleanEvents.length === 0) {
    return NextResponse.json({ error: "Selecione ao menos um evento válido" }, { status: 400 });
  }

  return runWithTenant(access.organizationId, async () => {
    const secret = generateWebhookSecret();
    const subscription = await prisma.webhookSubscription.create({
      data: {
        organizationId: access.organizationId,
        url: parsedUrl.toString(),
        secret,
        events: cleanEvents,
        createdById: access.userId,
      },
    });

    // secret só existe nesta resposta — nunca mais recuperável depois.
    return NextResponse.json(
      { id: subscription.id, url: subscription.url, events: subscription.events, secret, createdAt: subscription.createdAt },
      { status: 201 },
    );
  });
}
