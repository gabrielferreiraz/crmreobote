import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { resolveChatMediaUrl } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * Mensagens de UMA conversa arquivada/de backup — mesma ideia de GET
 * /api/whatsapp/messages/[threadId], mas: (1) só o Dono acessa, pra
 * qualquer usuário (não só o escopo de negócios de quem está vendo); (2)
 * NUNCA marca como lida — é uma consulta de auditoria/backup, não deveria
 * mexer no sinal de "lead respondeu" que o próprio dono da conversa (se
 * ainda ativo) usa no dia a dia; (3) SEM limite de quantidade — ao
 * contrário do chat ao vivo (que corta em 200 mensagens só por causa do
 * polling a cada 4s), o backup existe pra garantir que nada se perde,
 * mesmo numa conversa com centenas/milhares de mensagens.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ userId: string; threadId: string }> },
) {
  const { userId, threadId } = await params;

  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const thread = await prisma.whatsAppThread.findFirst({
      where: { id: threadId, organizationId: access.organizationId, ownerUserId: userId },
    });
    if (!thread) return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });

    const messages = await prisma.whatsAppMessage.findMany({
      where: { organizationId: access.organizationId, threadId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        direction: true,
        type: true,
        body: true,
        mediaUrl: true,
        status: true,
        createdAt: true,
      },
    });

    const resolved = await Promise.all(
      messages.map(async (msg) => ({
        ...msg,
        mediaUrl: msg.mediaUrl ? await resolveChatMediaUrl(msg.mediaUrl) : msg.mediaUrl,
      })),
    );

    return NextResponse.json({ messages: resolved });
  });
}
