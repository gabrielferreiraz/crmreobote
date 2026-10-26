import { NextResponse } from "next/server";
import { runWithTenant } from "@/lib/tenant-context";
import { requireCommissionManager, auditCommission, badRequest, commissionRoute } from "@/lib/commissions/route-helpers";
import { parseSaleInput, resolveSaleReferences } from "@/lib/commissions/sale-input";
import { loadEngineContext, regenerateSaleEntries, SALE_SELECT, withCommissionLock } from "@/lib/commissions/sync";
import { getSaleEntries } from "@/lib/commissions/queries";

export const dynamic = "force-dynamic";

const FIELD_LABELS: Record<string, string> = {
  clientName: "cliente",
  sellerId: "vendedor",
  administratorId: "administradora",
  modality: "modalidade",
  creditType: "tipo de crédito",
  saleDate: "data da venda",
  netValue: "valor líquido",
  grossValue: "valor bruto",
  clientInstallment: "parcela do cliente",
  autoDebit: "débito automático",
  quotaNumber: "cota",
  groupNumber: "grupo",
  notes: "observação",
};

/** Parcelas da venda (todas as pessoas) — painel da venda na tela do Financeiro. */
export const GET = commissionRoute(async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireCommissionManager();
  if ("error" in guard) return guard.error;
  const { access } = guard;
  const entries = await runWithTenant(access.organizationId, () => getSaleEntries(access.organizationId, id));
  return NextResponse.json({ entries });
});

/** Campos que mudam o VALOR/CALENDÁRIO da comissão — só eles disparam o recálculo das parcelas não pagas. */
const RECALC_FIELDS = new Set(["sellerId", "administratorId", "modality", "creditType", "saleDate", "netValue", "grossValue", "clientInstallment"]);

/**
 * Corrigir uma venda (consultor trocou bruto por líquido, administradora
 * errada, meia parcela…). Só muda a venda de COMISSÃO — o negócio fica como
 * está (alimenta meta/TV/relatórios do passado). Parcelas já pagas nunca são
 * tocadas; as demais são recalculadas na hora.
 */
export const PATCH = commissionRoute(async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireCommissionManager();
  if ("error" in guard) return guard.error;
  const { access } = guard;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Dados inválidos");
  const parsed = parseSaleInput(body as Record<string, unknown>, { partial: true });
  if (!parsed.ok) return badRequest(parsed.error);
  const data = parsed.data;
  if (Object.keys(data).length === 0) return badRequest("Nada para salvar");

  const refs = await runWithTenant(access.organizationId, () => resolveSaleReferences(access.organizationId, data));
  if ("error" in refs) return badRequest(refs.error!);

  const result = await withCommissionLock(access.organizationId, async (tx): Promise<{ error: NextResponse } | { clientName: string }> => {
    const existing = await tx.commissionSale.findFirst({
      where: { id, organizationId: access.organizationId },
      select: { id: true, status: true, sellerId: true, clientName: true },
    });
    if (!existing) return { error: NextResponse.json({ error: "Venda não encontrada" }, { status: 404 }) };
    if (existing.status === "CANCELLED") {
      return { error: NextResponse.json({ error: "Venda cancelada — reative antes de corrigir" }, { status: 409 }) };
    }
    // Venda conferida sem administradora = o vendedor perde de vista a comissão inteira.
    if (existing.status === "ACTIVE" && data.administratorId === null) {
      return { error: NextResponse.json({ error: "Venda já conferida precisa de administradora — escolha outra em vez de deixar em branco" }, { status: 409 }) };
    }

    // Trocar o vendedor fotografa de novo a equipe DELE (líder/gerente).
    const sellerChanged = data.sellerId !== undefined && data.sellerId !== existing.sellerId;
    // A divisão do vendedor (co-responsáveis) era do vendedor ANTERIOR: o Financeiro
    // escolheu outra pessoa, então a venda volta a ser 100% dela.
    if (sellerChanged) {
      await tx.commissionSaleShare.deleteMany({ where: { saleId: id } });
    }
    const updated = await tx.commissionSale.update({
      where: { id },
      data: {
        ...data,
        ...(sellerChanged ? { supervisorId: refs.team?.leaderId ?? null, managerId: refs.team?.managerId ?? null } : {}),
      },
      select: SALE_SELECT,
    });
    if (Object.keys(data).some((k) => RECALC_FIELDS.has(k))) {
      await regenerateSaleEntries(tx, updated, await loadEngineContext(tx, access.organizationId));
    }
    return { clientName: existing.clientName };
  });
  if ("error" in result) return result.error;

  await auditCommission(req, access, "COMMISSION_SALE_CHANGED", {
    targetType: "CommissionSale",
    targetId: id,
    detail: `${result.clientName}: corrigiu ${Object.keys(data).map((k) => FIELD_LABELS[k] ?? k).join(", ")}`,
  });
  return NextResponse.json({ ok: true });
});
