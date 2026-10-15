import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { getCommissionAccess, sellerVisibleFromMonth } from "@/lib/commissions/access";
import { getMyCommissionEntries } from "@/lib/commissions/queries";
import { syncCommissionSales } from "@/lib/commissions/sync";
import { brazilMonthKey } from "@/lib/commissions/engine";
import { brazilDayOfMonth } from "@/lib/timezone";
import { MyCommission } from "../_components/my-commission";

export const dynamic = "force-dynamic";

/** A própria comissão — pra qualquer pessoa, inclusive quem cuida das comissões e também vende. */
export default async function MyCommissionPage() {
  const access = await getCommissionAccess();
  if (!access.ok) redirect("/");
  if (!access.commissionsActive && !access.canManage) redirect("/");

  // Ganho por um caminho que não sincronizou (API, importação…) aparece
  // aqui do mesmo jeito — ver lib/commissions/sync.ts. Falhar aqui nunca
  // impede de ver o que já existe.
  await syncCommissionSales(access.organizationId).catch((err) => console.error("[commissions] sync na Minha comissão", err));

  return runWithTenant(access.organizationId, async () => {
    const org = await prisma.organization.findUnique({
      where: { id: access.organizationId },
      select: { commissionPayDay: true, commissionSellerPastMonths: true },
    });
    // Quem cuida das comissões vê tudo de qualquer forma — não faz sentido
    // esconder dele o próprio passado.
    const fromMonth = access.canManage ? "0000-01" : sellerVisibleFromMonth(org?.commissionSellerPastMonths ?? 0);
    const entries = await getMyCommissionEntries(access.organizationId, access.userId, fromMonth);
    return (
      <MyCommission entries={entries} currentMonth={brazilMonthKey()} todayDay={brazilDayOfMonth()} payDay={org?.commissionPayDay ?? 10} />
    );
  });
}
