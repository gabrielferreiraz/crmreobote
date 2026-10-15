import { NextResponse } from "next/server";
import { prisma, prismaRaw } from "@/lib/prisma";
import { runWithTenant, setTenantOnTx } from "@/lib/tenant-context";
import { requireCommissionManager, auditCommission, badRequest } from "@/lib/commissions/route-helpers";
import { countLegacyCandidates, importLegacySales, withCommissionLock } from "@/lib/commissions/sync";
import { brazilDateStringToUTC } from "@/lib/timezone";

export const dynamic = "force-dynamic";

/**
 * "Trazer vendas antigas": negócios ganhos ANTES do início do módulo, a
 * partir de `from`, entram "a conferir" — o Financeiro escolhe a
 * administradora, confere o valor e confirma antes de o consultor ver. As
 * parcelas de meses que já passaram nascem como pagas ("pago antes do
 * sistema"), combinado com o dono.
 */
async function resolveWindow(organizationId: string, fromRaw: unknown) {
  if (typeof fromRaw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fromRaw)) return { error: "Escolha a data inicial" };
  const org = await runWithTenant(organizationId, () =>
    prisma.organization.findUnique({ where: { id: organizationId }, select: { commissionStartDate: true } }),
  );
  if (!org?.commissionStartDate) return { error: "Defina primeiro o mês de início das comissões" };
  const from = brazilDateStringToUTC(fromRaw);
  if (from >= org.commissionStartDate) return { error: "A data inicial precisa ser antes do início das comissões" };
  return { from, until: org.commissionStartDate };
}

export async function GET(req: Request) {
  const guard = await requireCommissionManager();
  if ("error" in guard) return guard.error;
  const { access } = guard;

  const window = await resolveWindow(access.organizationId, new URL(req.url).searchParams.get("from"));
  if ("error" in window) return badRequest(window.error!);
  const count = await prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, access.organizationId);
    return countLegacyCandidates(tx, access.organizationId, window.from, window.until);
  });
  return NextResponse.json({ count });
}

export async function POST(req: Request) {
  const guard = await requireCommissionManager();
  if ("error" in guard) return guard.error;
  const { access } = guard;

  const body = (await req.json().catch(() => ({}))) as { from?: unknown; first?: unknown };
  const window = await resolveWindow(access.organizationId, body.from);
  if ("error" in window) return badRequest(window.error!);

  const result = await withCommissionLock(access.organizationId, async (tx) => {
    const imported = await importLegacySales(tx, access.organizationId, window.from, window.until);
    const remaining = await countLegacyCandidates(tx, access.organizationId, window.from, window.until);
    return { imported, remaining };
  });

  if (body.first === true) {
    await auditCommission(req, access, "COMMISSION_SALE_CHANGED", {
      targetType: "CommissionSale",
      detail: `Trouxe vendas antigas desde ${typeof body.from === "string" ? body.from.split("-").reverse().join("/") : "?"}`,
    });
  }
  return NextResponse.json(result);
}
