import { NextResponse } from "next/server";
import { runWithTenant } from "@/lib/tenant-context";
import { requireCommissionManager, auditCommission, badRequest } from "@/lib/commissions/route-helpers";
import { parseSaleInput, resolveSaleReferences } from "@/lib/commissions/sale-input";
import { loadEngineContext, regenerateSaleEntries, SALE_SELECT, withCommissionLock } from "@/lib/commissions/sync";

export const dynamic = "force-dynamic";

/** "Venda fora do CRM" — lançada à mão pelo Financeiro (sem negócio vinculado). */
export async function POST(req: Request) {
  const guard = await requireCommissionManager();
  if ("error" in guard) return guard.error;
  const { access } = guard;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Dados inválidos");
  const parsed = parseSaleInput(body as Record<string, unknown>, { partial: false });
  if (!parsed.ok) return badRequest(parsed.error);
  const data = parsed.data;

  const refs = await runWithTenant(access.organizationId, () => resolveSaleReferences(access.organizationId, data));
  if ("error" in refs) return badRequest(refs.error!);

  const sale = await withCommissionLock(access.organizationId, async (tx) => {
    const created = await tx.commissionSale.create({
      data: {
        organizationId: access.organizationId,
        source: "MANUAL",
        status: "ACTIVE",
        clientName: data.clientName!,
        sellerId: data.sellerId!,
        supervisorId: refs.team?.leaderId ?? null,
        managerId: refs.team?.managerId ?? null,
        administratorId: data.administratorId ?? null,
        modality: data.modality ?? "FULL",
        creditType: data.creditType ?? null,
        saleDate: data.saleDate!,
        netValue: data.netValue ?? null,
        grossValue: data.grossValue ?? null,
        clientInstallment: data.clientInstallment ?? null,
        quotaNumber: data.quotaNumber ?? null,
        groupNumber: data.groupNumber ?? null,
        notes: data.notes ?? null,
      },
      select: SALE_SELECT,
    });
    await regenerateSaleEntries(tx, created, await loadEngineContext(tx, access.organizationId));
    return created;
  });

  await auditCommission(req, access, "COMMISSION_SALE_CHANGED", {
    targetType: "CommissionSale",
    targetId: sale.id,
    detail: `Lançou venda fora do CRM: ${data.clientName}`,
  });
  return NextResponse.json({ id: sale.id }, { status: 201 });
}
