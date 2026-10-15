import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { getCommissionAccess } from "@/lib/commissions/access";
import { brazilMonthKey, parsePercentList } from "@/lib/commissions/engine";
import { SettingsView } from "../_components/settings-view";

export const dynamic = "force-dynamic";

export default async function CommissionSettingsPage() {
  const access = await getCommissionAccess();
  if (!access.ok) redirect("/");
  if (!access.canManage) redirect("/comissoes");

  return runWithTenant(access.organizationId, async () => {
    const organizationId = access.organizationId;
    const [org, administrators, rules, members, creditTypes] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: organizationId },
        select: { commissionStartDate: true, commissionPayDay: true, commissionSellerPastMonths: true },
      }),
      prisma.consortiumAdministrator.findMany({
        where: { organizationId },
        orderBy: [{ active: "desc" }, { name: "asc" }],
        include: { _count: { select: { sales: true, deals: true } } },
      }),
      prisma.commissionRule.findMany({
        where: { organizationId, active: true },
        include: { user: { select: { name: true } } },
        orderBy: [{ beneficiaryRole: "asc" }, { createdAt: "asc" }],
      }),
      prisma.organizationUser.findMany({
        where: { organizationId, active: true },
        select: { role: true, canManageCommissions: true, user: { select: { id: true, name: true } } },
        orderBy: { user: { name: "asc" } },
      }),
      prisma.creditType.findMany({ where: { organizationId }, orderBy: { order: "asc" }, select: { label: true } }),
    ]);

    return (
      <SettingsView
        currentMonth={brazilMonthKey()}
        startMonth={org?.commissionStartDate ? brazilMonthKey(org.commissionStartDate) : null}
        payDay={org?.commissionPayDay ?? 10}
        sellerPastMonths={org?.commissionSellerPastMonths ?? 0}
        administrators={administrators.map((a) => ({
          id: a.id,
          name: a.name,
          active: a.active,
          commissionInstallments: a.commissionInstallments,
          graceMonths: a.graceMonths,
          cutoffDay: a.cutoffDay,
          paysSellerDirectly: a.paysSellerDirectly,
          revenueMode: a.revenueMode,
          revenueTotalPercent: a.revenueTotalPercent != null ? Number(a.revenueTotalPercent) : null,
          revenuePercents: parsePercentList(a.revenuePercents),
          revenueBase: a.revenueBase === "GROSS" ? "GROSS" : "NET",
          salesCount: a._count.sales + a._count.deals,
        }))}
        rules={rules.map((r) => ({
          id: r.id,
          beneficiaryRole: r.beneficiaryRole,
          userId: r.userId,
          userName: r.user?.name ?? null,
          administratorId: r.administratorId,
          modality: r.modality,
          creditType: r.creditType,
          base: r.base,
          percent: Number(r.percent),
        }))}
        members={members.map((m) => ({ id: m.user.id, name: m.user.name, role: m.role, canManageCommissions: m.canManageCommissions }))}
        creditTypes={creditTypes.map((c) => c.label)}
        isOwner={access.isOwner}
      />
    );
  });
}
