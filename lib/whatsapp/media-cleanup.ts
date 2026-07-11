/**
 * Apaga do R2 imagem/áudio de chat mais antigos que a retenção configurada.
 * A mensagem em si (texto/legenda/tipo) continua existindo no histórico —
 * só o arquivo pesado é removido, `mediaUrl` vira null.
 */

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { deleteChatMedia } from "@/lib/r2";

const DEFAULT_RETENTION_DAYS = 90;

export async function cleanupExpiredChatMedia(
  retentionDays = DEFAULT_RETENTION_DAYS,
): Promise<{ organizationsChecked: number; mediaDeleted: number }> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  // Organization não tem RLS — listar todas aqui é seguro; cada organização
  // é processada depois já com o tenant certo definido (mesmo padrão do
  // runAutomations em lib/automations/engine.ts).
  const organizations = await prisma.organization.findMany({ select: { id: true } });

  let mediaDeleted = 0;

  for (const org of organizations) {
    await runWithTenant(org.id, async () => {
      const expired = await prisma.whatsAppMessage.findMany({
        where: { mediaUrl: { startsWith: "whatsapp-media/" }, createdAt: { lt: cutoff } },
        select: { id: true, mediaUrl: true },
      });

      for (const msg of expired) {
        if (!msg.mediaUrl) continue;
        try {
          await deleteChatMedia(msg.mediaUrl);
          await prisma.whatsAppMessage.update({ where: { id: msg.id }, data: { mediaUrl: null } });
          mediaDeleted += 1;
        } catch (err) {
          console.error(`[wa:media-cleanup] falha ao apagar mídia da mensagem ${msg.id}`, err);
        }
      }
    });
  }

  return { organizationsChecked: organizations.length, mediaDeleted };
}
