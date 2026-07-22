/**
 * Controle de acesso do módulo de Processos (pós-venda) — dois níveis, sem
 * hierarquia intermediária (diferente do pipeline de vendas, que tem
 * OWNER/MANAGER/SUPERVISOR/MEMBER com escopos diferentes):
 *
 * - `isAdmin: true` — enxerga e edita tudo (mover card, criar/editar etapa,
 *   marcar contemplado/pagamento/documentação). É quem tem
 *   `OrganizationUser.canManageProcesses`, ou qualquer OWNER (mesmo sem o
 *   campo marcado — mesma regra de "dono sempre vê tudo" do pipeline de
 *   vendas).
 * - `isAdmin: false` — só enxerga (nunca edita) os processos cujo
 *   `ownerId` é o próprio usuário (o negócio que ELE ganhou). Não tem
 *   relação nenhuma com o cargo de vendas (MEMBER, SUPERVISOR etc.) — um
 *   Gerente de vendas sem `canManageProcesses` cai neste mesmo nível.
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
      select: { active: true, role: true, canManageProcesses: true },
    }),
  );
  if (!membership?.active) return { ok: false };

  const isAdmin = membership.role === "OWNER" || membership.canManageProcesses;
  return { ok: true, isAdmin, organizationId, userId };
}

/** Filtro Prisma pra where de Process — admin não filtra nada, não-admin só os próprios. */
export function processScopeWhere(access: { isAdmin: boolean; userId: string }) {
  return access.isAdmin ? {} : { ownerId: access.userId };
}
