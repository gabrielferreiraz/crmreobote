import { prisma } from "@/lib/prisma";
import { brazilStartOfMonth, getBrazilParts } from "@/lib/timezone";

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

/**
 * Meta do mês corrente + quanto já foi Ganho — sempre organização inteira
 * (não respeita escopo de equipe/responsável, é uma meta só do time todo) e
 * sempre o mês civil de Brasília atual, igual ao GoalCard de Relatórios (ver
 * app/(dashboard)/relatorios/page.tsx, de onde essa lógica foi extraída pra
 * cá) — agora também usado pelo "% da meta" do Início e o card "valor em
 * aberto" do Pipeline (ver new-design-for-claude/README.md), pra não
 * duplicar a mesma consulta em três lugares.
 */
export async function getCurrentMonthGoalProgress(
  organizationId: string,
): Promise<{ goalValue: number | null; achievedValue: number }> {
  const nowParts = getBrazilParts(new Date());
  const [monthlyGoal, goalWonAgg] = await Promise.all([
    prisma.monthlyGoal.findUnique({
      where: { organizationId_year_month: { organizationId, year: nowParts.year, month: nowParts.month + 1 } },
    }),
    prisma.deal.aggregate({
      where: { organizationId, status: "WON", closedAt: { gte: brazilStartOfMonth() } },
      _sum: { value: true },
    }),
  ]);
  return {
    goalValue: monthlyGoal ? Number(monthlyGoal.value) : null,
    achievedValue: goalWonAgg._sum.value ? Number(goalWonAgg._sum.value) : 0,
  };
}
