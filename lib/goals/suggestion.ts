import { prisma } from "@/lib/prisma";

/** Meta sugerida por vendedor ativo (role Consultor/MEMBER) — decisão de
 * negócio da organização, não um valor técnico; se mudar, é só trocar aqui. */
export const GOAL_PER_SELLER = 1_200_000;

/**
 * Consultores (role MEMBER) ativos na área Vendas — a base do cálculo de
 * sugestão de meta (ver GoalCard). Dono/Gerente/Supervisor não entram na
 * conta: lideram e podem até vender, mas a meta de R$1,2M por cabeça é
 * especificamente sobre o quadro de consultores.
 */
export async function countActiveSellers(organizationId: string): Promise<number> {
  return prisma.organizationUser.count({
    where: { organizationId, active: true, role: "MEMBER", area: "VENDAS" },
  });
}

export function suggestedGoalValue(sellerCount: number): number {
  return sellerCount * GOAL_PER_SELLER;
}
