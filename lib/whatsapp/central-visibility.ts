import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { centralLeadsEnabled } from "@/lib/whatsapp/central-config";

/**
 * A aba "Atendimentos" aparece para quem tem o que fazer nela:
 *  - o DONO, sempre — é quem conecta o número da Central e define o rodízio
 *    (sem a aba visível, nenhuma empresa nova conseguiria ligar o recurso);
 *  - qualquer outro cargo, quando a empresa JÁ tem Central (número conectado
 *    ou conversas na fila — as conversas continuam existindo mesmo se o número
 *    for desconectado depois).
 * Antes disso, consultor/gerente/supervisor veriam uma aba vazia que diz "Dono
 * ainda não configurou" — ruído num produto que cada empresa usa de um jeito.
 *
 * O "a empresa tem Central?" é guardado por 1 min na memória do servidor: o
 * layout do WhatsApp roda em toda navegação e a resposta quase nunca muda.
 * Conectar ou desconectar a Central chama `forgetCentralVisibility`.
 */
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; has: boolean }>();

export function forgetCentralVisibility(organizationId: string): void {
  cache.delete(organizationId);
}

async function organizationHasCentral(organizationId: string): Promise<boolean> {
  const hit = cache.get(organizationId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.has;
  const has = await runWithTenant(organizationId, async () => {
    const [instance, queued] = await Promise.all([
      prisma.whatsAppInstance.findFirst({ where: { organizationId, kind: "CENTRAL" }, select: { id: true } }),
      prisma.whatsAppThread.findFirst({ where: { organizationId, inboxStatus: { not: null } }, select: { id: true } }),
    ]);
    return instance !== null || queued !== null;
  });
  cache.set(organizationId, { at: Date.now(), has });
  return has;
}

export async function shouldShowCentralTab(organizationId: string | undefined, role: string | undefined): Promise<boolean> {
  if (!centralLeadsEnabled() || !organizationId) return false;
  if (role === "OWNER") return true;
  return organizationHasCentral(organizationId);
}
