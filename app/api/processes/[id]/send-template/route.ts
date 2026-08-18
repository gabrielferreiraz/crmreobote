import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireProcessAccess } from "@/lib/processes/access";
import { runWithTenant } from "@/lib/tenant-context";
import { sendWhatsAppMessageToContact, WhatsAppSendError } from "@/lib/whatsapp/send";
import { notifyProcessTemplateToConsultant } from "@/lib/processes/notify";

export const dynamic = "force-dynamic";

/**
 * "Enviar modelo" — administrativo pede um documento/petição usando um
 * modelo salvo (ver ProcessTemplate), pro consultor OU direto pro cliente.
 * `message` já vem pronto do cliente (modelo + variáveis já resolvidas +
 * qualquer edição manual antes de enviar — ver lib/automations/variables.ts,
 * reaproveitado no componente); este endpoint não interpola nada de novo.
 *
 * Sempre grava um ProcessTemplateUsage (ver lib/processes/templates.ts —
 * alimenta o "já usado"/"mais usado nesta etapa" do seletor), além do
 * efeito específico de cada destino:
 * - CONSULTANT: vira um ProcessRequest endereçado a ele (mesma seção
 *   "Solicitações" que já existia, agora de mão dupla — ver schema.prisma),
 *   resolvido por ele quando terminar.
 * - LEAD: manda WhatsApp de verdade pro contato (via o número do
 *   consultor responsável) e registra uma nota administrativa pra ficar no
 *   histórico do processo.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const { templateId, target, message } = (body ?? {}) as {
    templateId?: string;
    target?: "CONSULTANT" | "LEAD";
    message?: string;
  };

  const access = await requireProcessAccess();
  if (!access.ok || !access.isAdmin) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  if (!templateId) return NextResponse.json({ error: "templateId é obrigatório" }, { status: 400 });
  if (target !== "CONSULTANT" && target !== "LEAD") return NextResponse.json({ error: "target inválido" }, { status: 400 });
  if (!message?.trim()) return NextResponse.json({ error: "Mensagem é obrigatória" }, { status: 400 });

  return runWithTenant(access.organizationId, async () => {
    const [process, template] = await Promise.all([
      prisma.process.findFirst({
        where: { id, organizationId: access.organizationId },
        include: { contact: { select: { id: true, name: true } }, owner: { select: { id: true, name: true } } },
      }),
      prisma.processTemplate.findFirst({ where: { id: templateId, organizationId: access.organizationId } }),
    ]);
    if (!process) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 });
    if (!template) return NextResponse.json({ error: "Modelo não encontrado" }, { status: 404 });

    const finalMessage = message.trim();
    let processRequest = null;

    if (target === "CONSULTANT") {
      processRequest = await prisma.processRequest.create({
        data: {
          processId: process.id,
          organizationId: access.organizationId,
          message: finalMessage,
          requestedById: access.userId,
          targetUserId: process.ownerId,
        },
        include: { requestedBy: { select: { id: true, name: true } }, targetUser: { select: { id: true, name: true } } },
      });

      notifyProcessTemplateToConsultant(
        { id: process.id, contactName: process.contact.name, ownerId: process.ownerId },
        template.name,
      ).catch((err) => console.error("[processes] falha ao notificar modelo pro consultor", err));
    } else {
      try {
        await sendWhatsAppMessageToContact({
          organizationId: access.organizationId,
          contactId: process.contact.id,
          ownerId: process.ownerId,
          text: finalMessage,
        });
      } catch (err) {
        if (err instanceof WhatsAppSendError) {
          return NextResponse.json({ error: err.message }, { status: 400 });
        }
        console.error("[processes] falha ao enviar modelo via WhatsApp", err);
        return NextResponse.json({ error: "Falha ao enviar mensagem" }, { status: 500 });
      }

      // Registro administrativo — mesma seção "Anotações do administrativo"
      // que já existe, pra ficar visível no histórico do processo mesmo
      // sendo um envio direto (sem "resolver" nada, diferente do consultor).
      await prisma.activity.create({
        data: {
          organizationId: access.organizationId,
          processId: process.id,
          contactId: process.contact.id,
          userId: access.userId,
          type: "NOTE",
          body: `Modelo "${template.name}" enviado ao cliente via WhatsApp.`,
        },
      });
    }

    await prisma.processTemplateUsage.create({
      data: {
        organizationId: access.organizationId,
        templateId: template.id,
        processId: process.id,
        stageId: process.stageId,
        target,
        usedById: access.userId,
      },
    });

    return NextResponse.json({ ok: true, processRequest }, { status: 201 });
  });
}
