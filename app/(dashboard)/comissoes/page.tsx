import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { getCommissionAccess } from "@/lib/commissions/access";
import { getCommissionWeight, getExpectedRevenue, getManagerAlerts, getMonthEntries, getMonthRange, getOpenDisputes } from "@/lib/commissions/queries";
import { syncCommissionSales } from "@/lib/commissions/sync";
import { brazilMonthKey, isMonthKey } from "@/lib/commissions/engine";
import { ManagerMonth } from "./_components/manager-month";

export const dynamic = "force-dynamic";

/**
 * Entrada do módulo: quem cuida das comissões cai na mesa do mês; qualquer
 * outra pessoa vai pra "Minha comissão" (a própria, e só ela).
 */
export default async function CommissionsPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const access = await getCommissionAccess();
  if (!access.ok) redirect("/");
  if (!access.canManage) redirect(access.commissionsActive ? "/comissoes/minha" : "/");

  await syncCommissionSales(access.organizationId).catch((err) => console.error("[commissions] sync na mesa do Financeiro", err));

  const { mes } = await searchParams;
  const currentMonth = brazilMonthKey();
  const month = isMonthKey(mes) ? mes : currentMonth;

  return runWithTenant(access.organizationId, async () => {
    const [org, administratorsCount, rulesCount, entries, alerts, range, members, disputes, expectedRevenue] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: access.organizationId },
        select: { commissionStartDate: true, commissionPayDay: true },
      }),
      prisma.consortiumAdministrator.count({ where: { organizationId: access.organizationId, active: true } }),
      prisma.commissionRule.count({ where: { organizationId: access.organizationId, active: true } }),
      getMonthEntries(access.organizationId, month),
      getManagerAlerts(access.organizationId),
      getMonthRange(access.organizationId),
      prisma.organizationUser.findMany({
        where: { organizationId: access.organizationId, active: true },
        select: { user: { select: { id: true, name: true } } },
        orderBy: { user: { name: "asc" } },
      }),
      getOpenDisputes(access.organizationId),
      getExpectedRevenue(access.organizationId, month),
    ]);
    // Transação própria com tenant (SQL direto) — fora do Promise.all acima.
    const weight = await getCommissionWeight(access.organizationId);

    return (
      <ManagerMonth
        month={month}
        currentMonth={currentMonth}
        firstMonth={range.first < month ? range.first : month}
        lastMonth={range.last > month ? range.last : month}
        entries={entries}
        alerts={alerts}
        payDay={org?.commissionPayDay ?? 10}
        setup={{ started: !!org?.commissionStartDate, administratorsCount, rulesCount }}
        members={members.map((m) => m.user)}
        disputes={disputes}
        weight={weight}
        expectedRevenue={expectedRevenue}
      />
    );
  });
}
