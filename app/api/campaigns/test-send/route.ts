import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { getOrCreateThread } from "@/lib/whatsapp/threads";
import { sendWhatsAppMessage, WhatsAppSendError } from "@/lib/whatsapp/send";
import { normalizePhoneNumber } from "@/lib/phone-normalize";
import { validateSteps } from "@/lib/campaigns/scripts";
import { rateLimitOrResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const MAX_TEST_STEPS = 20;

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
  const { instanceId, phone, steps: rawSteps } = body as {
    instanceId?: string;
    phone?: string;
    steps?: unknown;
  };

  const access = await requireRole(["OWNER", "ADMIN"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  // Sem isso, uma chamada só podia carregar uma sequência arbitrariamente
  // grande de mensagens (delayAfterSec: 0 entre elas) e virar uma rajada de
  // WhatsApp disfarçada de "teste" — nunca passou pela validação/corte que
  // uma campanha de verdade tem em resolveCampaignInput.
  const rateLimited = rateLimitOrResponse(`campaign-test-send:${access.organizationId}`, 20, 60_000);
  if (rateLimited) return rateLimited;

  if (!instanceId) return NextResponse.json({ error: "Selecione de qual WhatsApp enviar" }, { status: 400 });

  const validated = validateSteps(rawSteps);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
  if (validated.steps.length > MAX_TEST_STEPS) {
    return NextResponse.json({ error: `Um teste aceita no máximo ${MAX_TEST_STEPS} mensagens na sequência` }, { status: 400 });
  }
  const steps = validated.steps;

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
