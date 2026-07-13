import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithInstanceLookup, runWithTenant } from "@/lib/tenant-context";
import { handleIncomingMessage, handleStatusUpdate, handleConnectionUpdate, handleIncomingCall } from "@/lib/whatsapp/events";

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
    console.warn("[wa:webhook] requisição rejeitada: segredo ausente/incorreto na URL");
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = await req.json().catch((err) => {
    console.error("[wa:webhook] corpo da requisição não é JSON válido", err);
    return null;
  });
  const instanceName = body?.instance as string | undefined;
  const event = (body?.event as string | undefined)?.toLowerCase();
  const data = body?.data;

  console.log(`[wa:webhook] recebido: instance="${instanceName}" event="${event}"`);

  // Payload que não reconhecemos: responde 200 mesmo assim, senão o Evolution
  // fica reenviando o mesmo evento indefinidamente.
  if (!instanceName || !event) {
    console.warn("[wa:webhook] ignorado: instance ou event ausente no payload", JSON.stringify(body));
    return NextResponse.json({ ok: true });
  }

  const instance = await runWithInstanceLookup(instanceName, () =>
    prisma.whatsAppInstance.findUnique({ where: { instanceName } }),
  );
  if (!instance) {
    console.warn(`[wa:webhook] ignorado: nenhuma WhatsAppInstance com instanceName="${instanceName}"`);
    return NextResponse.json({ ok: true });
  }

  return runWithTenant(instance.organizationId, async () => {
    if (event === "messages.upsert") {
      await handleIncomingMessage(instance, data);
    } else if (event === "messages.update") {
      await handleStatusUpdate(instance, data);
    } else if (event === "connection.update") {
      await handleConnectionUpdate(instance, data);
    } else if (event === "call") {
      await handleIncomingCall(instance, data);
    } else {
      console.log(`[wa:webhook] evento "${event}" recebido mas não tratado (nenhum handler pra ele ainda)`);
    }
    return NextResponse.json({ ok: true });
  });
}
