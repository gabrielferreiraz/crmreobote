import { NextResponse } from "next/server";
import { requireCommissionManager, auditCommission, badRequest, commissionRoute } from "@/lib/commissions/route-helpers";
import { isMonthKey, formatMonthShort } from "@/lib/commissions/engine";
import { runCommissionBonusCalculation } from "@/lib/commissions/bonus-run";

export const dynamic = "force-dynamic";

/**
 * "Calcular bônus do mês" — botão manual (nunca automático, ver docstring de
 * bonus-run.ts). Idempotente: clicar de novo no mesmo mês só cria o que
 * ainda faltava (ex.: meta cadastrada depois, ou faixa nova destravada por
 * venda que entrou depois), nunca duplica nem rebaixa um prêmio já dado.
 */
export const POST = commissionRoute(async function POST(req: Request) {
  const guard = await requireCommissionManager();
  if ("error" in guard) return guard.error;
  const { access } = guard;

  const body = await req.json().catch(() => null);
  const month = body && typeof body === "object" ? (body as Record<string, unknown>).month : undefined;
  if (!isMonthKey(month)) return badRequest("Escolha o mês");

  const result = await runCommissionBonusCalculation(access.organizationId, month, access.userId);

  const total = result.awarded.reduce((sum, a) => sum + a.amount, 0);
  await auditCommission(req, access, "COMMISSION_BONUS_CALCULATED", {
    targetType: "CommissionBonusRule",
    detail: `${formatMonthShort(month)}: ${result.awarded.length} prêmio${result.awarded.length === 1 ? "" : "s"} concedido${result.awarded.length === 1 ? "" : "s"}, total R$ ${total.toFixed(2)}`,
  });
  return NextResponse.json(result);
});
