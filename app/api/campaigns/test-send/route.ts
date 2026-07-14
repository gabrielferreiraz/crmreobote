import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { getOrCreateThread } from "@/lib/whatsapp/threads";
import { sendWhatsAppMessage, WhatsAppSendError } from "@/lib/whatsapp/send";
import { normalizePhoneNumber } from "@/lib/phone-normalize";

export const dynamic = "force-dynamic";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Manda um envio de teste (a sequência inteira do script, com o delay real
 * entre as partes) pra um número escolhido, antes de criar/rodar a campanha
 * de verdade — os textos já vêm prontos do cliente (spintax e variáveis já
 * resolvidos lá, com dados de exemplo), então esta rota só precisa achar/
 * criar a conversa e despachar em sequência, igual o motor da campanha faz
 * depois pra cada destinatário real.
 */
export async function POST(req: Request) {
  const body = await req.json();
  const { instanceId, phone, steps } = body as {
    instanceId?: string;
    phone?: string;
    steps?: { text: string; delayAfterSec: number }[];
  };

  const access = await requireRole(["OWNER", "ADMIN"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  if (!instanceId) return NextResponse.json({ error: "Selecione de qual WhatsApp enviar" }, { status: 400 });
  if (!steps?.length || steps.some((s) => !s.text.trim())) {
    return NextResponse.json({ error: "Mensagem vazia" }, { status: 400 });
  }
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
      for (let i = 0; i < steps.length; i++) {
        await sendWhatsAppMessage({ organizationId: access.organizationId, threadId: thread.id, text: steps[i].text });
        if (i < steps.length - 1 && steps[i].delayAfterSec > 0) {
          await sleep(steps[i].delayAfterSec * 1000);
        }
      }
    } catch (err) {
      if (err instanceof WhatsAppSendError) return NextResponse.json({ error: err.message }, { status: 400 });
      throw err;
    }

    return NextResponse.json({ ok: true });
  });
}
