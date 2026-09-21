import { cache } from "react";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import type { $Enums } from "@/app/generated/prisma/client";

export type CurrentMembership = {
  session: Session;
  organizationId: string;
  userId: string;
  active: boolean;
  role: $Enums.OrgRole;
  area: $Enums.UserArea;
  canManageProcesses: boolean;
  photoKey: string | null;
  /** Atalho "Cartão de visita" do menu do usuário (ver components/user-menu.tsx).
   * Vem junto nesta consulta (um JOIN em FK única) em vez de uma consulta
   * própria: isto aqui roda em TODA navegação do dashboard, e cada operação
   * do Prisma custa ~4,7 idas-e-voltas ao Postgres por causa da transação
   * de RLS (medido, ver withTenantRls em lib/prisma.ts) — uma consulta
   * separada só pra montar um href era uma ida-e-volta inteira por página. */
  cardShortcut: { slug: string; active: boolean } | null;
};

/**
 * Uma consulta só de "sessão + filiação" por requisição — reaproveitada por
 * requireSession/requireRole/getCurrentUserArea/DashboardLayout, que antes
 * cada um fazia sua PRÓPRIA consulta idêntica (mesmo organizationId+userId),
 * então uma única página do dashboard batia essa mesma consulta 2-4x antes
 * de sequer começar a buscar o dado que a página de fato mostra. `cache()`
 * do React memoiza pelo tempo de UM request/render (não entre requisições —
 * uma desativação no meio ainda derruba a sessão na PRÓXIMA página, igual
 * antes; ver node_modules/next/dist/docs/01-app/02-guides/
 * caching-without-cache-components.md#deduplicating-requests).
 */
export const getCurrentMembership = cache(async (): Promise<CurrentMembership | null> => {
  const session = await auth();
  if (!session?.user?.organizationId) return null;

  const organizationId = session.user.organizationId;
  const userId = session.user.id;

  // Roda dentro de runWithTenant (storage.run), não setTenant/enterWith —
  // enterWith não garante que o contexto sobreviva até esta consulta ser de
  // fato executada (RLS bloqueia tudo em silêncio sem contexto). Reconfere
  // sempre no banco (nunca confia só no JWT) — uma desativação precisa
  // derrubar sessões já emitidas, não só bloquear logins novos.
  const membership = await runWithTenant(organizationId, () =>
    prisma.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: {
        active: true,
        role: true,
        area: true,
        canManageProcesses: true,
        user: {
          select: {
            image: true,
            digitalCard: { select: { slug: true, active: true } },
          },
        },
      },
    }),
  );
  if (!membership) return null;

  return {
    session,
    organizationId,
    userId,
    active: membership.active,
    role: membership.role,
    area: membership.area,
    canManageProcesses: membership.canManageProcesses,
    photoKey: membership.user.image,
    cardShortcut: membership.user.digitalCard,
  };
});
