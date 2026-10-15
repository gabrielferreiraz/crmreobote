/**
 * Quem pode o quê no módulo de Comissões — dois níveis só:
 *
 * - `canManage: true` — o Financeiro: cadastra administradoras/regras,
 *   confere vendas, trava/paga parcelas, enxerga a comissão de TODO MUNDO.
 *   É quem tem `OrganizationUser.canManageCommissions`, ou qualquer OWNER
 *   (mesma regra de "dono sempre pode" de Processos).
 * - `canManage: false` — qualquer outra pessoa ativa: só a PRÓPRIA comissão,
 *   e só do mês atual em diante (menos o que a organização liberar em
 *   Organization.commissionSellerPastMonths). Supervisor/gerente veem o que
 *   eles mesmos recebem (inclusive sobre a equipe), nunca a comissão de cada
 *   consultor.
 *
 * Sempre confere no banco (getCurrentMembership não confia só no JWT).
 */

import { getCurrentMembership } from "@/lib/current-membership";
import { isCrmRestrictedByAcademy } from "@/lib/academy-onboarding";
import { addMonths, brazilMonthKey } from "@/lib/commissions/engine";

export type CommissionAccess =
  | {
      ok: true;
      canManage: boolean;
      isOwner: boolean;
      commissionsActive: boolean;
      organizationId: string;
      userId: string;
      actorName: string;
    }
  | { ok: false };

export async function getCommissionAccess(): Promise<CommissionAccess> {
  const membership = await getCurrentMembership();
  if (!membership?.active) return { ok: false };
  if (isCrmRestrictedByAcademy(membership.role, membership.area, membership.academyOnboardingStatus)) return { ok: false };

  const isOwner = membership.role === "OWNER";
  return {
    ok: true,
    canManage: isOwner || membership.canManageCommissions,
    isOwner,
    commissionsActive: membership.commissionsActive,
    organizationId: membership.organizationId,
    userId: membership.userId,
    actorName: membership.session.user.name ?? membership.session.user.email ?? "?",
  };
}

/** Primeiro mês ("YYYY-MM") que o consultor ainda enxerga. */
export function sellerVisibleFromMonth(pastMonths: number, now: Date = new Date()): string {
  return addMonths(brazilMonthKey(now), -Math.max(0, pastMonths));
}
