import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { getCommissionAccess } from "@/lib/commissions/access";
import { getSalesList, type SaleFilter } from "@/lib/commissions/queries";
import { syncCommissionSales } from "@/lib/commissions/sync";
import { brazilMonthKey } from "@/lib/commissions/engine";
import { brazilDateKey } from "@/lib/timezone";
import { SalesView } from "../_components/sales-view";

export const dynamic = "force-dynamic";

const FILTERS: SaleFilter[] = ["atencao", "conferir", "todas", "canceladas"];

export default async function CommissionSalesPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; q?: string; venda?: string }>;
}) {
  const access = await getCommissionAccess();
  if (!access.ok) redirect("/");
  if (!access.canManage) redirect("/comissoes");

  await syncCommissionSales(access.organizationId).catch((err) => console.error("[commissions] sync em Vendas", err));

  const { f, q = "", venda } = await searchParams;
  const filter: SaleFilter = FILTERS.includes(f as SaleFilter) ? (f as SaleFilter) : "atencao";
  const organizationId = access.organizationId;

  return runWithTenant(organizationId, async () => {
    const [attention, reviewCount, org, members, administrators, creditTypes] = await Promise.all([
      getSalesList(organizationId, "atencao", filter === "atencao" ? q : ""),
      prisma.commissionSale.count({ where: { organizationId, status: "REVIEW" } }),
      prisma.organization.findUnique({ where: { id: organizationId }, select: { commissionStartDate: true } }),
      prisma.organizationUser.findMany({
        where: { organizationId, active: true },
        select: { user: { select: { id: true, name: true } } },
        orderBy: { user: { name: "asc" } },
      }),
      prisma.consortiumAdministrator.findMany({
        where: { organizationId, active: true },
        select: { id: true, name: true, revenueMode: true },
        orderBy: { name: "asc" },
      }),
      prisma.creditType.findMany({ where: { organizationId }, orderBy: { order: "asc" }, select: { label: true } }),
    ]);
    const sales = filter === "atencao" ? attention : await getSalesList(organizationId, filter, q);

    let openSale = venda ? (sales.find((s) => s.id === venda) ?? null) : null;
    if (venda && !openSale) openSale = (await getSalesList(organizationId, "todas", "", { id: venda }))[0] ?? null;

    // Vendedor que saiu da empresa continua aparecendo na venda dele.
    const memberOptions = members.map((m) => m.user);
    if (openSale && !memberOptions.some((m) => m.id === openSale!.sellerId)) {
      memberOptions.push({ id: openSale.sellerId, name: openSale.sellerName });
    }
    // Administradora desativada continua aparecendo na venda que já tem ela.
    const administratorOptions = [...administrators];
    if (openSale?.administratorId && !administratorOptions.some((a) => a.id === openSale!.administratorId)) {
      administratorOptions.push({ id: openSale.administratorId, name: openSale.administratorName ?? "—", revenueMode: null });
    }

    const start = org?.commissionStartDate ?? null;
    const startKey = start ? brazilDateKey(start) : null;
    const legacy =
      start && startKey
        ? {
            // Padrão: 12 meses antes do início — cobre administradora que paga em até 10x + carência.
            defaultFrom: `${Number(startKey.slice(0, 4)) - 1}${startKey.slice(4)}`,
            maxDate: brazilDateKey(new Date(start.getTime() - 86_400_000)),
          }
        : null;

    return (
      <SalesView
        filter={filter}
        search={q}
        sales={sales}
        counts={{ atencao: attention.length, conferir: reviewCount }}
        openSale={openSale}
        currentMonth={brazilMonthKey()}
        options={{ members: memberOptions, administrators: administratorOptions, creditTypes: creditTypes.map((c) => c.label) }}
        legacy={legacy}
      />
    );
  });
}
