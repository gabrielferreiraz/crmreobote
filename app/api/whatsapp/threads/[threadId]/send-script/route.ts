import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import { getDealScope } from "@/lib/team-scope";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";
import { renderSteps } from "@/lib/campaigns/spintax";
import { brazilGreeting } from "@/lib/timezone";
import type { Contact } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildVariables(contact: Contact | null) {
  return { nome: contact?.name ?? "", cargo: contact?.jobTitle, empresa: contact?.company, cidade: contact?.city };
}

/**
 * Dispara manualmente, pra uma conversa específica, a sequência de mensagens
 * de um script salvo (ver Scripts) — mesmo motor de variáveis/spintax das
 * campanhas (lib/campaigns/spintax.ts), só que a partir de um clique no chat
 * em vez do cron de prospecção fria.
 */
export async function POST(req: Request, { params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;
  const { scriptId } = (await req.json().catch(() => ({}))) as { scriptId?: string };
  if (!scriptId) return NextResponse.json({ error: "scriptId é obrigatório" }, { status: 400 });

  const { session, organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const thread = await prisma.whatsAppThread.findFirst({
      where: { id: threadId, organizationId },
      include: { instance: { select: { userId: true, status: true } }, contact: true },
    });
    if (!thread) return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });

    const scope = await getDealScope(organizationId, userId, session!.user.role);
    if (scope.type === "owners" && !scope.ownerIds.includes(thread.instance.userId)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    // Checa a conexão ANTES de responder 202 — sendWhatsAppMessage já lança
    // esse mesmo erro lá dentro do loop em segundo plano, mas só logado
    // (console.error), nunca visto por quem clicou "Enviar"; sem essa
    // checagem aqui, o modal mostra "Enviando..." e fecha sozinho mesmo
    // quando NENHUMA mensagem do script sai de verdade.
    if (thread.instance.status !== "CONNECTED") {
      return NextResponse.json({ error: "O WhatsApp desta conversa não está conectado no CRM" }, { status: 400 });
    }

    const script = await prisma.messageScript.findFirst({ where: { id: scriptId, organizationId } });
    if (!script) return NextResponse.json({ error: "Script não encontrado" }, { status: 404 });

    const steps = renderSteps(
      script.steps as { text: string; delayAfterSec: number }[],
      buildVariables(thread.contact),
      brazilGreeting(),
    );
    if (steps.length === 0) return NextResponse.json({ error: "Script sem mensagens" }, { status: 400 });

    // Roda em segundo plano (não é aguardado): o próprio script pode ter
    // delay de até alguns minutos entre mensagens (mesma lógica de
    // lib/campaigns/engine.ts) — a requisição do navegador não deve ficar
    // pendurada esperando isso. Cada mensagem enviada aparece no chat aberto
    // pelo polling normal (a cada 4s), como se estivesse sendo digitada aos
    // poucos.
    void (async () => {
      for (let i = 0; i < steps.length; i++) {
        try {
          await sendWhatsAppMessage({ organizationId, threadId, text: steps[i].text, type: "TEXT", sentByUserId: userId });
        } catch (err) {
          console.error(`[send-script] falha ao enviar etapa ${i + 1}/${steps.length} do script ${scriptId} na conversa ${threadId}`, err);
        }
        if (i < steps.length - 1 && steps[i].delayAfterSec > 0) {
          await sleep(steps[i].delayAfterSec * 1000);
        }
      }
    })();

    return NextResponse.json({ ok: true, steps: steps.length }, { status: 202 });
  });
}
