import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { formatBrazilianPhone } from "@/lib/phone-normalize";

export const dynamic = "force-dynamic";

const PREVIEW_FALLBACK: Record<string, string> = {
  IMAGE: "📷 Imagem",
  AUDIO: "🎵 Áudio",
  CONTACT: "👤 Contato",
  PIX: "💰 Pix",
  STICKER: "🧩 Figurinha",
  CALL: "📞 Chamada",
};

/**
 * Lista as conversas de WhatsApp de UM usuário específico — usado pelo
 * botão "Backup de mensagens" em Configurações > Usuários. Diferente da
 * lista normal de Conversas (lib/whatsapp/conversations.ts), aqui aparecem
 * TAMBÉM as conversas órfãs (instanceId null — instância apagada de
 * verdade, ver ownerUserId em prisma/schema.prisma): é exatamente esse
 * histórico "congelado" que sobrevive à desativação do usuário que este
 * botão existe pra mostrar. Só o Dono pode ver — é conversa privada de
 * outra pessoa.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;

  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const member = await prisma.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId: access.organizationId, userId } },
      include: { user: { select: { id: true, name: true } } },
    });
    if (!member) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    const threads = await prisma.whatsAppThread.findMany({
      where: { organizationId: access.organizationId, ownerUserId: userId },
      include: {
        contact: { select: { id: true, name: true } },
        instance: { select: { status: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, type: true, direction: true, createdAt: true } },
        _count: { select: { messages: true } },
      },
    });

    const threadsWithMessages = threads.filter((t) => t.messages.length > 0);
    threadsWithMessages.sort((a, b) => b.messages[0].createdAt.getTime() - a.messages[0].createdAt.getTime());

    return NextResponse.json({
      user: { id: member.user.id, name: member.user.name, active: member.active },
      threads: threadsWithMessages.map((t) => {
        const lastMessage = t.messages[0];
        return {
          id: t.id,
          displayName: t.contact?.name ?? t.whatsappName ?? formatBrazilianPhone(t.phoneNormalized) ?? t.phoneNormalized,
          phoneFormatted: formatBrazilianPhone(t.phoneNormalized) ?? t.phoneNormalized,
          contactId: t.contact?.id ?? null,
          // Instância ainda existe e está conectada = conversa "viva" (pode
          // aparecer também em Conversas, se o usuário estiver ativo);
          // instância null = histórico arquivado, congelado na desativação.
          archived: !t.instance,
          messageCount: t._count.messages,
          lastMessagePreview: lastMessage.body || PREVIEW_FALLBACK[lastMessage.type] || "—",
          lastMessageDirection: lastMessage.direction,
          lastMessageAt: lastMessage.createdAt,
        };
      }),
    });
  });
}
