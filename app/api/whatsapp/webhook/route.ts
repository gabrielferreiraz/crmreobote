import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithInstanceLookup, runWithTenant } from "@/lib/tenant-context";
import { handleIncomingMessage, handleStatusUpdate, handleConnectionUpdate } from "@/lib/whatsapp/events";

export const dynamic = "force-dynamic";

// Chamado pelo Evolution API, não por um usuário logado — a autenticação é o
// segredo compartilhado na própria URL (ver buildWebhookUrl em
// app/api/whatsapp/instance/route.ts), não uma sessão.
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET;
  const provided = req.nextUrl.searchParams.get("secret");
  return !!secret && provided === secret;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const instanceName = body?.instance as string | undefined;
  const event = (body?.event as string | undefined)?.toLowerCase();
  const data = body?.data;

  // Payload que não reconhecemos: responde 200 mesmo assim, senão o Evolution
  // fica reenviando o mesmo evento indefinidamente.
  if (!instanceName || !event) {
    return NextResponse.json({ ok: true });
  }

  const instance = await runWithInstanceLookup(instanceName, () =>
    prisma.whatsAppInstance.findUnique({ where: { instanceName } }),
  );
  if (!instance) return NextResponse.json({ ok: true });

  return runWithTenant(instance.organizationId, async () => {
    if (event === "messages.upsert") {
      await handleIncomingMessage(instance, data);
    } else if (event === "messages.update") {
      await handleStatusUpdate(instance, data);
    } else if (event === "connection.update") {
      await handleConnectionUpdate(instance, data);
    }
    return NextResponse.json({ ok: true });
  });
}
