import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { requireCommissionManager, auditCommission, badRequest, commissionRoute } from "@/lib/commissions/route-helpers";
import { addMonths, brazilMonthKey, formatMonthLong, isMonthKey } from "@/lib/commissions/engine";
import { brazilDateStringToUTC } from "@/lib/timezone";
import { syncCommissionSales } from "@/lib/commissions/sync";

export const dynamic = "force-dynamic";

/**
 * Configurações gerais do módulo:
 * - `startMonth` ("YYYY-MM" ou null): a partir de que mês todo negócio
 *   ganho vira comissão sozinho. Sempre no dia 1º do mês (combinado com o
 *   dono: nunca metade de um mês em cada sistema). No máximo 3 meses pra
 *   trás — mais antigo que isso entra por "Trazer vendas antigas", que
 *   passa pela conferência do Financeiro.
 * - `payDay`: dia do pagamento (só exibição).
 * - `sellerPastMonths`: quantos meses anteriores o consultor ainda vê.
 */
export const PATCH = commissionRoute(async function PATCH(req: Request) {
  const guard = await requireCommissionManager();
  if ("error" in guard) return guard.error;
  const { access } = guard;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return badRequest("Dados inválidos");

  const data: { commissionStartDate?: Date | null; commissionPayDay?: number; commissionSellerPastMonths?: number } = {};
  const changes: string[] = [];

  if (body.startMonth !== undefined) {
    if (body.startMonth === null) {
      data.commissionStartDate = null;
      changes.push("desligou o cálculo automático");
    } else {
      if (!isMonthKey(body.startMonth)) return badRequest("Mês inválido");
      const current = brazilMonthKey();
      if (body.startMonth < addMonths(current, -3)) {
        return badRequest("Escolha no máximo 3 meses para trás — vendas mais antigas entram por \"Trazer vendas antigas\"");
      }
      if (body.startMonth > addMonths(current, 12)) return badRequest("Mês muito distante");
      data.commissionStartDate = brazilDateStringToUTC(`${body.startMonth}-01`);
      changes.push(`começa a contar em ${formatMonthLong(body.startMonth)}`);
    }
  }
  if (body.payDay !== undefined) {
    const n = Number(body.payDay);
    if (!Number.isInteger(n) || n < 1 || n > 31) return badRequest("Dia do pagamento deve ser de 1 a 31");
    data.commissionPayDay = n;
    changes.push(`pagamento dia ${n}`);
  }
  if (body.sellerPastMonths !== undefined) {
    const n = Number(body.sellerPastMonths);
    if (!Number.isInteger(n) || n < 0 || n > 24) return badRequest("Opção inválida");
    data.commissionSellerPastMonths = n;
    changes.push(n === 0 ? "consultor vê só do mês atual em diante" : `consultor vê ${n} ${n === 1 ? "mês" : "meses"} pra trás`);
  }
  if (changes.length === 0) return badRequest("Nada para salvar");

  await runWithTenant(access.organizationId, () =>
    prisma.organization.update({ where: { id: access.organizationId }, data }),
  );
  await auditCommission(req, access, "COMMISSION_SETTINGS_CHANGED", {
    targetType: "Organization",
    targetId: access.organizationId,
    detail: changes.join(" · "),
  });

  // Ligou (ou mudou o início): já converte os negócios ganhos desde então,
  // em vez de esperar a próxima abertura da tela.
  if (data.commissionStartDate) await syncCommissionSales(access.organizationId);

  return NextResponse.json({ ok: true });
});
