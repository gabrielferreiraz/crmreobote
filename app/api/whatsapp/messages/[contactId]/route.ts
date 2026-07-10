import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import { sendWhatsAppMessage, WhatsAppSendError } from "@/lib/whatsapp/send";
import { resolveChatMediaUrl } from "@/lib/r2";
import type { $Enums } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

const VALID_TYPES: $Enums.WhatsAppMessageType[] = [
  "TEXT",
  "IMAGE",
  "AUDIO",
  "CONTACT",
  "PIX",
  "BUTTONS",
  "LIST",
];

export async function GET(_req: Request, { params }: { params: Promise<{ contactId: string }> }) {
  const { contactId } = await params;

  const { organizationId } = await requireSession();
  if (!organizationId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const contact = await prisma.contact.findFirst({ where: { id: contactId, organizationId } });
    if (!contact) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const messages = await prisma.whatsAppMessage.findMany({
      where: { organizationId, contactId },
      orderBy: { createdAt: "asc" },
    });

    // mediaUrl no banco pode ser uma chave interna do R2 (mídia enviada pelo
    // composer nativo) — o navegador precisa de uma URL de verdade pra exibir.
    const resolved = await Promise.all(
      messages.map(async (msg) => ({
        ...msg,
        mediaUrl: msg.mediaUrl ? await resolveChatMediaUrl(msg.mediaUrl) : msg.mediaUrl,
      })),
    );

    return NextResponse.json(resolved);
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ contactId: string }> }) {
  const { contactId } = await params;
  const requestBody = await req.json();
  const { text, type, mediaUrl, metadata } = requestBody as {
    text?: string;
    type?: string;
    mediaUrl?: string;
    metadata?: Record<string, unknown>;
  };

  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!text?.trim()) return NextResponse.json({ error: "Mensagem vazia" }, { status: 400 });
  if (type && !VALID_TYPES.includes(type as $Enums.WhatsAppMessageType)) {
    return NextResponse.json({ error: "Tipo de mensagem inválido" }, { status: 400 });
  }

  return runWithTenant(organizationId, async () => {
    try {
      const message = await sendWhatsAppMessage({
        organizationId,
        contactId,
        ownerId: userId,
        text: text.trim(),
        type: type as $Enums.WhatsAppMessageType | undefined,
        mediaUrl,
        metadata,
      });
      return NextResponse.json(message, { status: 201 });
    } catch (err) {
      const message = err instanceof WhatsAppSendError ? err.message : "Falha ao enviar mensagem";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  });
}
