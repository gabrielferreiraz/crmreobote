import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { listBackupThreads } from "@/lib/whatsapp/backup";

export const dynamic = "force-dynamic";

/**
 * Lista as conversas de WhatsApp de UM usuário específico — usado pela tela
 * Configurações > Backup de mensagens. Diferente da lista normal de Conversas
 * (lib/whatsapp/conversations.ts), aqui aparecem TAMBÉM as conversas órfãs
 * (instanceId null — instância apagada de verdade, ver ownerUserId em
 * prisma/schema.prisma): é exatamente esse histórico "congelado" que sobrevive
 * à desativação do usuário. Só o Dono pode ver — é conversa privada de outra
 * pessoa.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;

  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const member = await runWithTenant(access.organizationId, () =>
    prisma.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId: access.organizationId, userId } },
      include: { user: { select: { id: true, name: true } } },
    }),
  );
  if (!member) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const threads = await listBackupThreads(access.organizationId, userId);

  return NextResponse.json({
    user: { id: member.user.id, name: member.user.name, active: member.active },
    threads: threads.map((t) => ({
      id: t.id,
      displayName: t.displayName,
      phoneFormatted: t.phoneFormatted,
      contactId: t.contactId,
      archived: t.archived,
      messageCount: t.messageCount,
      lastMessagePreview: t.lastMessagePreview,
      lastMessageDirection: t.lastMessageDirection,
      lastMessageAt: t.lastMessageAt,
      firstMessageAt: t.firstMessageAt,
    })),
  });
}
