/**
 * Controle de acesso do módulo de Processos (pós-venda) — dois níveis, sem
 * hierarquia intermediária (diferente do pipeline de vendas, que tem
 * OWNER/MANAGER/SUPERVISOR/MEMBER com escopos diferentes):
 *
 * - `isAdmin: true` — enxerga e edita tudo (mover card, criar/editar etapa,
 *   marcar contemplado/pagamento/documentação), de TODOS os clientes
 *   ganhos da organização. É quem tem `area: ADMINISTRATIVO` (o time de
 *   pós-venda em si), qualquer OWNER (mesma regra de "dono sempre vê tudo"
 *   do pipeline de vendas), ou quem tem `OrganizationUser.canManageProcesses`
 *   marcado à parte (ex.: um gerente de vendas que também ajuda no
 *   pós-venda, sem precisar virar Administrativo).
 * - `isAdmin: false` — só enxerga (nunca edita) os processos cujo
 *   `ownerId` é o próprio usuário (o negócio que ELE ganhou). É o caso do
 *   consultor comum (`area: VENDAS`, sem `canManageProcesses`).
 *
 * Sempre confere no banco (não confia só no JWT), mesmo padrão de
 * requireSession/requireRole — desativação/mudança de permissão precisa
 * valer imediatamente, mesmo com sessão já emitida.
 */

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

export type ProcessAccess =
  | { ok: true; isAdmin: boolean; organizationId: string; userId: string }
  | { ok: false };

export async function requireProcessAccess(): Promise<ProcessAccess> {
  const session = await auth();
  if (!session?.user?.organizationId) return { ok: false };

  const organizationId = session.user.organizationId;
  const userId = session.user.id;

  const membership = await runWithTenant(organizationId, () =>
    prisma.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { active: true, role: true, area: true, canManageProcesses: true },
    }),
  );
  if (!membership?.active) return { ok: false };

  const isAdmin = membership.role === "OWNER" || membership.area === "ADMINISTRATIVO" || membership.canManageProcesses;
  return { ok: true, isAdmin, organizationId, userId };
}

/** Filtro Prisma pra where de Process — admin não filtra nada, não-admin só os próprios. */
export function processScopeWhere(access: { isAdmin: boolean; userId: string }) {
  return access.isAdmin ? {} : { ownerId: access.userId };
}
