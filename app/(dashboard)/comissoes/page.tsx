import { after } from "next/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { getCommissionAccess } from "@/lib/commissions/access";
import { getCommissionWeight, getManagerOverview, getMonthEntries, getOpenDisputes } from "@/lib/commissions/queries";
import { syncOnPageOpen } from "@/lib/commissions/sync";
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

  // Depois de enviar a tela (rede de segurança pra negócio ganho por um
  // caminho que não sincronizou) — esperar aqui custava ~0,5 s em cada abertura.
  after(() => syncOnPageOpen(access.organizationId, "mesa do Financeiro"));

  const { mes } = await searchParams;
  const currentMonth = brazilMonthKey();
  const month = isMonthKey(mes) ? mes : currentMonth;

  return runWithTenant(access.organizationId, async () => {
    // 5 consultas ao mesmo tempo (eram 10): os números pequenos vêm todos juntos em getManagerOverview.
    const [overview, entries, members, disputes, weight] = await Promise.all([
      getManagerOverview(access.organizationId, month),
      getMonthEntries(access.organizationId, month),
      prisma.organizationUser.findMany({
        where: { organizationId: access.organizationId, active: true },
        select: { user: { select: { id: true, name: true } } },
        orderBy: { user: { name: "asc" } },
      }),
      getOpenDisputes(access.organizationId),
      // Transação própria com tenant (SQL direto, prismaRaw) — roda junto, não depois.
      getCommissionWeight(access.organizationId),
    ]);

    return (
      <ManagerMonth
        month={month}
        currentMonth={currentMonth}
        firstMonth={overview.range.first < month ? overview.range.first : month}
        lastMonth={overview.range.last > month ? overview.range.last : month}
        entries={entries}
        alerts={overview.alerts}
        payDay={overview.payDay}
        setup={{ started: overview.started, administratorsCount: overview.administratorsCount, rulesCount: overview.rulesCount }}
        members={members.map((m) => m.user)}
        disputes={disputes}
        weight={weight}
        expectedRevenue={overview.expectedRevenue}
      />
    );
  });
}
