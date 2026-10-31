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
  /** "Cuida das comissões" (ver OrganizationUser.canManageCommissions) — OWNER sempre pode, independente disto (ver lib/commissions/access.ts). */
  canManageCommissions: boolean;
  /** Módulo de Comissões ligado (Organization.commissionStartDate preenchido) — decide se o menu mostra "Comissões" pra quem não cuida delas. */
  commissionsActive: boolean;
  academyOnboardingStatus: $Enums.AcademyOnboardingStatus;
  academyShortcutHintSeenAt: Date | null;
  photoKey: string | null;
  /** E-mail atual do usuário, lido do banco (não do JWT) — ver lib/sheets/access.ts. */
  email: string | null;
  /** Nome atual, lido do banco (não do JWT) — ver app/api/painel-nichos-sso/route.ts. */
  name: string | null;
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
        canManageCommissions: true,
        organization: { select: { commissionStartDate: true } },
        academyOnboardingStatus: true,
        academyShortcutHintSeenAt: true,
        user: {
          select: {
            image: true,
            email: true,
            name: true,
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
    canManageCommissions: membership.canManageCommissions,
    commissionsActive: membership.organization.commissionStartDate != null,
    academyOnboardingStatus: membership.academyOnboardingStatus,
    academyShortcutHintSeenAt: membership.academyShortcutHintSeenAt,
    photoKey: membership.user.image,
    email: membership.user.email,
    name: membership.user.name,
    cardShortcut: membership.user.digitalCard,
  };
});
