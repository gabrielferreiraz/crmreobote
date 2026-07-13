import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { getOrCreateThread } from "@/lib/whatsapp/threads";
import { sendWhatsAppMessage, WhatsAppSendError } from "@/lib/whatsapp/send";
import { normalizePhoneNumber } from "@/lib/phone-normalize";

export const dynamic = "force-dynamic";

/**
 * Manda um envio de teste (uma mensagem só, pra um número escolhido) antes
 * de criar/rodar a campanha de verdade — o texto já vem pronto do cliente
 * (spintax e variáveis já resolvidos lá, com dados de exemplo), então esta
 * rota só precisa achar/criar a conversa e despachar, igual o motor da
 * campanha faz depois pra cada destinatário real.
 */
export async function POST(req: Request) {
  const body = await req.json();
  const { instanceId, phone, text } = body as { instanceId?: string; phone?: string; text?: string };

  const access = await requireRole(["OWNER", "ADMIN"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  if (!instanceId) return NextResponse.json({ error: "Selecione de qual WhatsApp enviar" }, { status: 400 });
  if (!text?.trim()) return NextResponse.json({ error: "Mensagem vazia" }, { status: 400 });
  const phoneNormalized = normalizePhoneNumber(phone);
  if (!phoneNormalized) return NextResponse.json({ error: "Número de teste inválido" }, { status: 400 });

  return runWithTenant(access.organizationId, async () => {
    const instance = await prisma.whatsAppInstance.findFirst({
      where: { id: instanceId, organizationId: access.organizationId },
    });
    if (!instance) return NextResponse.json({ error: "Instância de WhatsApp inválida" }, { status: 400 });

    try {
      const thread = await getOrCreateThread({
        organizationId: access.organizationId,
        instanceId,
        phoneNormalized,
      });
      await sendWhatsAppMessage({ organizationId: access.organizationId, threadId: thread.id, text });
    } catch (err) {
      if (err instanceof WhatsAppSendError) return NextResponse.json({ error: err.message }, { status: 400 });
      throw err;
    }

    return NextResponse.json({ ok: true });
  });
}
